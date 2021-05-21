import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import {Context} from '@actions/github/lib/context'
import * as io from '@actions/io'

async function run(): Promise<void> {
  const applyOnDefaultBranchOnly: boolean = core.getInput('apply-on-default-branch-only').toLocaleLowerCase() === 'true'
  const applyOnPullRequest: boolean = core.getInput('apply-on-pull-request').toLocaleLowerCase() === 'true'
  let comment: boolean = core.getInput('terraform-output-as-comment').toLocaleLowerCase() === 'true'
  let commentPrefix: string | undefined = core.getInput('comment-prefix')
  const detectDrift: boolean = core.getInput('detect-drift').toLocaleLowerCase() === 'true'
  const githubToken: string | undefined = core.getInput('github-token')
  const upgradeOnInit: boolean = core.getInput('upgrade-on-init').toLocaleLowerCase() === 'true'
  const validate: boolean = core.getInput('validate').toLocaleLowerCase() === 'true'
  const workingDirectory: string = core.getInput('working-directory')

  let output = ''
  let errorOutput = ''
  const options: exec.ExecOptions = {}
  const terraformPath = await io.which('terraform', true)

  try {
    const issue_number: number | undefined = getIssueNumber(github.context)
    //repository dispatch and schedule always happens on the main branch so no need for further checks
    // prettier-ignore
    const apply = github.context.eventName === 'repository_dispatch' || github.context.eventName === "schedule" ?
      true :
      checkApply(github.context, applyOnDefaultBranchOnly, applyOnPullRequest)

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

    const initCommand: string[] = ['init']
    if (upgradeOnInit) {
      initCommand.push('-upgrade')
    }

    core.info('Initialize Terraform')
    await exec.exec(terraformPath, initCommand, options)

    if (validate) {
      core.info('Validate Terraform Code')
      await exec.exec(terraformPath, ['validate'], options)
    }

    core.info('Refresh Terraform State')
    await exec.exec(terraformPath, ['refresh'], options)

    output = ''
    core.info('Run Terraform Plan')

    //if detectDrift is on, ignoreReturnCode for terraform plan will be set to true
    //so that a plan that has drifted, which returns with exit code 2 doesn't terminate the action.
    const planCommand: string[] = ['plan', '-refresh=false', '-no-color', '-out=plan']

    //I think we only want detect drift for schedule and, maybe, for workflow_dispatch
    if (detectDrift && (github.context.eventName === 'schedule' || github.context.eventName === 'workflow_dispatch')) {
      options.ignoreReturnCode = true
      planCommand.push('-detailed-exitcode')
    }

    const returnCode: number = await exec.exec(terraformPath, planCommand, options)

    if (returnCode === 1) {
      core.setFailed(`Terraform plan returned an exit code of 1, which indicates failure.\nOutput from Terraform:\n${output}`)
    }

    core.setOutput('terraform-plan-exit-code', returnCode)

    options.ignoreReturnCode = false

    if (comment) {
      core.info('Add Plan Output as a Comment to PR')

      if (!commentPrefix) {
        commentPrefix = 'Output from Terraform plan'
      }

      if (github.context.eventName === 'push') {
        commentPrefix += ' before Apply'
      }
      await addComment(issue_number, commentPrefix, output, githubToken, github.context, false)
    }

    output = ''
    if (apply && returnCode === 0) {
      core.info('Apply Terraform')
      await exec.exec(terraformPath, ['apply', 'plan', '-no-color'], options)

      if (!commentPrefix) {
        commentPrefix = 'Output From Terraform Apply'
      }

      if (comment) {
        core.info('Add Apply Output as a Comment to PR')
        await addComment(issue_number, commentPrefix, output, githubToken, github.context, true)
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
function getIssueNumber(context: Context): number | undefined {
  let issue_number: number | undefined

  core.debug(`Event Name: ${context.eventName}`)
  //The event when the pr is merged is actually push to the branch you are merging with, generally main/master˝
  if (context.eventName === 'pull_request' || context.eventName === 'push') {
    if (context.payload?.pull_request != null) {
      if (core.isDebug()) {
        core.debug('Get Issue Number off pull request payload')
        core.debug(JSON.stringify(context.payload))
      }
      issue_number = context.payload.pull_request?.number
    } else if (context.payload?.issue != null) {
      if (core.isDebug()) {
        core.debug('Get Issue Number off issue payload')
        core.debug(JSON.stringify(context.payload))
      }

      issue_number = context.payload.issue?.number
    }

    if (!issue_number) {
      if (core.isDebug()) {
        core.debug(`No issue number trying regex of head commit message: ${context.payload.head_commit.message}`)
        core.debug(JSON.stringify(context.payload))
      }

      const matches = context.payload.head_commit.message.match(/(?<=#)\d+/g)

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
function checkApply(context: Context, applyOnDefaultBranchOnly: boolean, applyOnPullRequest: boolean): boolean {
  let apply = false

  if (context.eventName === 'pull_request') {
    return applyOnPullRequest
  }

  if (context.eventName === 'push' || context.eventName === 'workflow_dispatch') {
    if (core.isDebug()) {
      core.debug('Checking whether we should apply or not')
      core.debug(JSON.stringify(context.payload))
    }
    if (applyOnDefaultBranchOnly) {
      const tempBranch = context.payload?.ref.split('/')
      core.debug(tempBranch)
      const currentBranch = tempBranch[tempBranch.length - 1]
      core.debug(currentBranch)
      if (context.payload.repository?.default_branch === currentBranch) {
        apply = true
      }
    } else {
      apply = true
    }
  }
  return apply
}

async function addComment(
  issue_number: number | undefined,
  prefix: string,
  message: string,
  github_token: string,
  context: Context,
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

    let formattedMessage = `${prefix}\n\`\`\`${message}\`\`\``

    //Github Comments have a limit of 65536 so hence this.
    if (formattedMessage.length >= 65535) {
      //  The -16 at the end is is just in case I've got my sums wrong :)
      const warning = `The output of the operation is longer than the comment limit in Github, please look at the full plan in the action run: https://github.com/${context.repo.owner}/${context.repo.repo}/actions/run/${context.runNumber}`
      formattedMessage = `${warning}\n${prefix}\n\`\`\`${message.substring(0, 65535 - prefix.length - warning.length - 16)}\`\`\``
    }

    if (isClosed) {
      await octokit.rest.pulls.createReview({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: issue_number,
        body: formattedMessage,
        event: 'COMMENT'
      })
    } else {
      await octokit.rest.issues.createComment({
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
