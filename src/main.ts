import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as io from '@actions/io'

async function run(): Promise<void> {
  const workingDirectory: string = core.getInput('working-directory')
  const validate: boolean = core.getInput('validate').toLocaleLowerCase() === 'true'
  const githubToken: string = core.getInput('github-token', { required: true })

  let comment: boolean = core.getInput('terraform-output-as-comment').toLocaleLowerCase() === 'true'

  let output = ''
  let errorOutput = ''

  const terraformPath = await io.which('terraform', true)

  try {
    const issue_number: number | undefined = getIssueNumber(github.context)

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
    await exec.exec(terraformPath, ['plan', '-refresh=false', '-no-color'], options)

    if (comment && !(github.context.eventName === 'push' || github.context.payload.pull_request?.merged)) {
      core.info('Add Plan Output as a Comment to PR')
      await addComment(issue_number, output, githubToken, github.context, false)
    }

    output = ''
    if (github.context.eventName === 'push' || github.context.payload.pull_request?.merged) {
      core.info('Apply Terraform')
      await exec.exec(terraformPath, ['apply', '-auto-approve', '-no-color'], options)

      if (comment) {
        core.info('Add Apply Output as a Comment to PR')
        await addComment(issue_number, output, githubToken, github.context, true)
      }
    }

    //Incantation completed, we have successfully summoned the terraform daemon.
  } catch (error) {
    core.error(errorOutput)
    core.setFailed(error.message)
  }

  function getIssueNumber(context: any): number | undefined {
    let issue_number: number | undefined

    if (core.isDebug()) {
      if (context.payload.pull_request != null) {

        let debugObject: Array<object> = new Array()
        const values = Object.values(github.context.payload)
        values.forEach(value => {

          if (typeof (value) === 'object') {
            debugObject.push(Object.values(value))
          }
          else {
            debugObject.push(value)
          }

        })
        const commaJoinedValues = debugObject.join(',')
        core.debug(commaJoinedValues)
      }

      issue_number = context.payload.pull_request.number
    } else if (github.context.payload.issue != null) {
      issue_number = github.context.payload.issue.number
    }

    if (!issue_number && context.eventName !== 'push') {
      if (core.isDebug()) {
        let debugObject: Array<object> = new Array()
        const values = Object.keys(github.context.payload).map(key => github.context.payload[key])
        values.forEach(value => {

          if (typeof (value) === 'object') {
            debugObject.push(Object.values(value))
          }
          else {
            debugObject.push(value)
          }

        })
        const commaJoinedValues = debugObject.join(',')
        core.debug(commaJoinedValues)
      }

      issue_number = parseInt(github.context.payload.head_commit.message.match(/(?<=#)\d+/g)[0])
    }

    core.debug(`Issue Number: ${issue_number}`)

    return issue_number
  }
}

run()

async function addComment(
  issue_number: number | undefined,
  message: string,
  github_token: string,
  context: any,
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

    const formattedMessage = `\`\`\`${message}\`\`\``

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

    core.debug(`Message Added`)
  } catch (error) {
    core.setFailed(error.message)
    return false
  }

  return true
}
