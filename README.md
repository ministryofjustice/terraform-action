## Terraform Action

This action performs the terraform incantation and will add the output of the terraform plan and apply commands to the pull request.

## Usage

On your workflow file, add the following:

```yml
      - uses: ministryofjustice/terraform-action@v1
        with:
          github-token: ${{secrets.GITHUB_TOKEN}}
```

This will run, from the root of the repo, terraform init, terraform validate, terraform plan with terraform apply only being run if the branch is the default branch of the repo (main/master)
If run from a Pull Request it will add the output of plan and apply to the pull request as a comment.


```yml
      - uses: ministryofjustice/terraform-action@v1
        with:
          apply-on-default-branch-only: false
          github-token: ${{secrets.GITHUB_TOKEN}}
          working-directory: terraformcode
```

This will run, from the terraformcode directory, terraform init, terraform validate, terraform plan with terraform apply being run for any branch on push or workflow_dispatch events.
If run from a Pull Request it will add the output of plan and apply to the pull request as a comment.



```yml
      - uses: ministryofjustice/terraform-action@v1
        with:
          apply-on-pull-request: true
          terraform-output-as-comment: false
          working-directory: terraformcode
```

This will run, from the terraformcode directory, terraform init, terraform validate, terraform plan with terraform apply being run on any branch for pull_request or the main branch for push or workflow_dispatch events.


## Workflow options

These are the options recommended to be changed. For more detailed explanation of the workflow file, check out the [GitHub documentation](https://help.github.com/en/articles/configuring-a-workflow#creating-a-workflow-file).

| Setting      | Description                                                                                | Default Value |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `apply-on-default-branch-only` |if true, `terraform apply` will only be run on the default branch of the repo. | true |
| `apply-on-pull-request` | if true, `terraform apply` will run on pull requests too. | false |
| `detect-drift` | If this flag is set to true `terraform plan` will run with `-detailed-exitcode` flag on, which can be used to detect drift. | false |
| `github-token` | The personal access token, `${{ secrets.GITHUB_TOKEN }}` should be enough.| N/A |
| `terraform-output-as-comment` | if true, the output from terraform plan and apply will be added to the PR as a comment.| true |
| `upgrade-on-init` | If set to true, the `terraform init` command will run with -upgrade flag | false |
| `validate` | If true, `terraform validate` is run before running the terraform incantation | true |
| `working-directory` | Directory where the terraform code is | Root of repository |


## Outputs

| Output      | Description                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------ |
|`terraform-plan-exit-code`| This is particularly useful when using `detect-drift` as the exit code will be set to 2 if there is drift |