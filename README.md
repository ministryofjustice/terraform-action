## Terraform Action

This action performs the terraform incantation and will add the output of the terraform plan and apply commands to the pull request.


## Getting Started

> First, you'll need to have a reasonably modern version of `node` handy. This won't work with versions older than 9, for instance.

Install the dependencies
```bash
$ npm install
```

Build the typescript and package it for distribution
```bash
$ npm run build && npm run package
```

You can now make changes to the code in src

## Testing

You can test the action with [nektos/act](https://github.com/nektos/act)

I like to use the full image but this is 18GB

```bash
$ docker pull nektos/act-environments-ubuntu:18.04
```

```bash
$ act pull_request -P ubuntu-latest=nektos/act-environments-ubuntu:18.04
```

It's possible to pass an event payload like this:

```bash
$ act pull_request -e event.json -P ubuntu-latest=nektos/act-environments-ubuntu:18.04
```

Unfortunately I've had mixed success getting a true payload.

If you'd rather use the regular image, then you can just run:

```bash
$ act pull_request -e event.json
```

or just

```bash
$ act
```


## TODO

- Run terraform fmt and commit result if there are changes (note that this might prevent the status check pipeline from passing)
- Turnstyle functionality, namely only allow one pipeline run at a time to avoid issues with locked files.
- Return exitcode for plan to allow alerts to be triggered on drift
- Sort out versioning and releases
- Collapse old comments containing plan outputs (e.g. if the pipeline is run several times, there will be a bunch of comments each time) 
