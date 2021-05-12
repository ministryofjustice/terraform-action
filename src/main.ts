import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as io from '@actions/io'

async function run(): Promise<void> {
  const workingDirectory: string = core.getInput('working-directory')
  const validate: boolean = core.getInput('validate').toLocaleLowerCase() === 'true'
  const githubToken: string | undefined = core.getInput('github-token')
  const applyOnDefaultBranchOnly: boolean = core.getInput('apply-on-default-branch-only').toLocaleLowerCase() === 'true'
  const applyOnPullRequest: boolean = core.getInput('apply-on-pull-request').toLocaleLowerCase() === 'true'
  let comment: boolean = core.getInput('terraform-output-as-comment').toLocaleLowerCase() === 'true'

  let output = ''
  let errorOutput = ''
  let premessage = ''

  const terraformPath = await io.which('terraform', true)

  try {
    const issue_number: number | undefined = getIssueNumber()
    //repository dispatch always happens on the main branch so no need for further checks
    const apply = github.context.eventName === 'repository_dispatch' ? true : checkApply(applyOnDefaultBranchOnly, applyOnPullRequest)

    const options: exec.ExecOptions = {}

    options.listeners = {
      stdout: (data: Buffer) => {
        output += data.toString()
      },
      stderr: (data: Buffer) => {
        errorOutput += data.toString()
      }
    }

    if (workingDirectory.length !== -1) {
      options.cwd = workingDirectory
    }

    if (!issue_number || !githubToken) {
      comment = false
      if (!githubToken) {
        core.info('No Github Token provided, will not add any comments.')
      }
    }

    //Start of Incantation

    core.info('Initialize Terraform')
    await exec.exec(terraformPath, ['init'], options)

    if (validate) {
      core.info('Validate Terraform Code')
      await exec.exec(terraformPath, ['validate'], options)
    }

    core.info('Refresh Terraform State')
    await exec.exec(terraformPath, ['refresh'], options)

    output = ''
    core.info('Run Terraform Plan')
    await exec.exec(terraformPath, ['plan', '-refresh=false', '-no-color', '-out=plan'], options)

    if (comment) {
      core.info('Add Plan Output as a Comment to PR')
      if (github.context.eventName === 'push') {
        premessage = 'Output from Terraform plan before Apply\n'
      }
      await addComment(issue_number, premessage, output, githubToken, github.context, false)
    }

    output = ''
    if (apply) {
      core.info('Apply Terraform')
      await exec.exec(terraformPath, ['apply', 'plan', '-no-color'], options)

      if (comment) {
        core.info('Add Apply Output as a Comment to PR')
        await addComment(issue_number, 'Output From Terraform Apply\n', output, githubToken, github.context, true)
      }
    }

    //Incantation completed, we have successfully summoned the terraform daemon.
  } catch (error) {
    core.error(errorOutput)
    core.setFailed(error.message)
  }
}

run()

//issue with the typings forces reliance on global object, which is probably ok here. Hey, that's my story and I'm sticking to it
function getIssueNumber(): number | undefined {
  let issue_number: number | undefined

  core.debug(`Event Name: ${github.context.eventName}`)
  //The event when the pr is merged is actually push to the branch you are merging with, generally main/master˝
  if (github.context.eventName === 'pull_request' || github.context.eventName === 'push') {
    if (github.context.payload?.pull_request != null) {
      if (core.isDebug()) {
        core.debug('Get Issue Number off pull request payload')
        core.debug(JSON.stringify(github.context.payload))
      }
      issue_number = github.context.payload.pull_request?.number
    } else if (github.context.payload?.issue != null) {
      if (core.isDebug()) {
        core.debug('Get Issue Number off issue payload')
        core.debug(JSON.stringify(github.context.payload))
      }

      issue_number = github.context.payload.issue?.number
    }

    if (!issue_number) {
      if (core.isDebug()) {
        core.debug(`No issue number trying regex of head commit message: ${github.context.payload.head_commit.message}`)
        core.debug(JSON.stringify(github.context.payload))
      }

      const matches = github.context.payload.head_commit.message.match(/(?<=#)\d+/g)

      if (matches) {
        issue_number = parseInt(matches[0])
      }
    }
    core.debug(`Issue Number: ${issue_number}`)
  }

  return issue_number
}
//We want to apply on push and workflow, which have a ref field on the payload of form refs/head/branchname
//We need to check then whether we're on the right branch to apply depending on applyOnDefaultBranch
//Pull Request is a special case, if we have apply-on-pull-request set to true, it will apply.
function checkApply(applyOnDefaultBranchOnly: boolean, applyOnPullRequest: boolean): boolean {
  let apply = false

  if (github.context.eventName === 'pull_request') {
    return applyOnPullRequest
  }

  if (github.context.eventName === 'push' || github.context.eventName === 'workflow_dispatch') {
    if (core.isDebug()) {
      core.debug('Checking whether we should apply or not')
      core.debug(JSON.stringify(github.context.payload))
    }
    if (applyOnDefaultBranchOnly) {
      const tempBranch = github.context.payload?.ref.split('/')
      core.debug(tempBranch)
      const currentBranch = tempBranch[tempBranch.length - 1]
      core.debug(currentBranch)
      if (github.context.payload.repository?.default_branch === currentBranch) {
        apply = true
      }
    } else {
      apply = true
    }
  }
  return apply
}

//I can't get the typings to work so ... I beg forgiveness
async function addComment(
  issue_number: number | undefined,
  premessage: string | undefined,
  message: string,
  github_token: string,
  context: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  isClosed: boolean
): Promise<boolean> {
  try {
    core.debug('Add Comment')

    if (!issue_number) {
      return true
    }

    const octokit = github.getOctokit(github_token)

    core.debug(`owner: ${context.repo.owner}`)
    core.debug(`repo: ${context.repo.repo}`)

    const formattedMessage = `${premessage}\`\`\`${message}\`\`\``

    if (isClosed) {
      await octokit.pulls.createReview({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: issue_number,
        body: formattedMessage,
        event: 'COMMENT'
      })
    } else {
      await octokit.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: formattedMessage,
        issue_number
      })
    }

    core.debug(`Message Added ${message}`)
  } catch (error) {
    core.setFailed(error.message)
    return false
  }

  return true
}
