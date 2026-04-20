# Security Policy

Thank you for helping keep Trixty IDE and its users safe.

## Supported Versions

Only the latest released version of Trixty IDE receives security updates. Please make sure you are running the latest version before reporting an issue.

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| Older releases | No |

## Reporting a Vulnerability

Please **do not open a public issue** for security vulnerabilities.

Report suspected vulnerabilities privately through GitHub's **Private Vulnerability Reporting**:

1. Go to https://github.com/TrixtyAI/ide/security/advisories/new
2. Fill in the advisory form with:
   - A clear description of the issue and its impact
   - Steps to reproduce (a minimal proof of concept is ideal)
   - Affected versions and platforms (Windows, macOS, Linux)
   - Any suggested remediation

If Private Vulnerability Reporting is not available for you, please **do not share vulnerability details publicly** (including in Discussions or public issues). Instead, use any existing private contact channel you already have with the maintainers to request a secure way to submit the report.

## What to Expect

- We will acknowledge receipt within a reasonable time frame.
- We will work with you to understand and validate the report.
- We aim to provide a fix or a mitigation plan as quickly as possible, prioritized by severity.
- Once a fix is released, we will credit the reporter in the release notes (unless you prefer to stay anonymous).

## Scope

Security reports are welcome for any component of the Trixty IDE repository, including:

- The Tauri application and its Rust backend
- The Next.js frontend and bundled extensions
- Build and release tooling under `.github/` and `scripts/`

Please avoid testing techniques that could harm other users or the infrastructure (denial of service, social engineering, physical attacks).

## Out of Scope

- Third-party extensions not maintained in this repository.
- Vulnerabilities in upstream dependencies that already have a public advisory — please open a regular issue or PR to bump the dependency.
