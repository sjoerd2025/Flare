# Windows signing with SignPath

SignPath Foundation eligibility is approved. **The production certificate has not
yet been issued.** First run test signing, then send the working GitHub Actions
run to SignPath for review and production-certificate issuance.

## One-time account setup

1. Accept the invitation to the OSS organization. Its ID is
   `d5edea92-dfed-4a46-aa85-32c94fdec2c1`; the project slug is `Flare`.
2. In SignPath, connect the project to the GitHub.com trusted build system and
   `AlgoNoRhythm/Flare`. Install/authorize the SignPath GitHub App as required by
   the organization's integration settings.
3. Under the project, create artifact configurations with these exact slugs:
   - `windows-app`: paste [windows-app.xml](../build/signpath/windows-app.xml).
   - `windows-installer`: paste [windows-installer.xml](../build/signpath/windows-installer.xml).
   Both have a `<zip-file>` root because Actions uploads an artifact archive.
4. Configure `test-signing` with the provided self-signed test certificate.
   Keep `release-signing` for the production certificate once SignPath issues it.
   If your test policy has another slug, change the two workflow references.
5. Add the user whose API token will be used to each policy's **Submitters**.
   Configure the required approvers according to your Foundation setup.
6. In [GitHub Actions secrets](https://github.com/AlgoNoRhythm/Flare/settings/secrets/actions),
   add `SIGNPATH_API_TOKEN`, using the token from that SignPath user's details page.
   Do not put the token in a file, workflow, issue, or chat.

These account settings cannot be applied from an unauthenticated local checkout.
The XML files describe the intended configuration; adding them to Git does not
automatically create the configurations in SignPath.

## First test run

Push the signing setup to GitHub, then run **Actions → Release → Run workflow**
on that branch with **dry_run checked**. Windows submits two signing requests
using `test-signing`; approve them in SignPath if prompted. Each request can wait
up to one hour. The resulting packages remain Actions artifacts, not a release.

The self-signed test certificate is trusted in the disposable GitHub-hosted
runner's CurrentUser certificate store so Windows can verify the signatures.
The verification script refuses this mode outside GitHub-hosted runners.
Test packages are not trusted on users' machines and must not be distributed as
production releases. Production runs never enable test-certificate trust.

Send SignPath the successful run URL and request their setup review. Once they
have imported the production certificate and associated it with `release-signing`,
a version tag uses that policy and uploads verified packages to the draft release.
A manual run with dry_run unchecked also uses release signing and must target an
existing version tag, as required by the release workflow.

## What the workflow signs

1. Build the unpacked Windows app with its final icon and version metadata.
2. Submit `Flare.exe`, verify its timestamped signature, and put it back into the app.
3. Build NSIS and ZIP packages from that already-signed app without editing it again.
4. Sign the NSIS installer, verify that it uses the same certificate as the app,
   and verify the app extracted from the portable ZIP.
5. Regenerate the installer blockmap and update YAML hashes/sizes after signing.
   Release upload happens only after successful verification; there is no unsigned fallback.

The NSIS-generated **uninstaller is not signed by this two-stage integration**.
Signing it requires a separate signing hook during NSIS construction; signing the
outer installer does not sign the uninstaller. Third-party binaries retain their
existing signatures; they are not re-signed with Flare's certificate. Confirm this
scope with SignPath during their review.

Local `npm run dist` remains an unsigned packaging command. Foundation signing
uses GitHub-hosted builds and their verified origin, rather than locally uploaded
artifacts from the PowerShell example.

References: [SignPath GitHub integration](https://docs.signpath.io/trusted-build-systems/github),
[artifact configuration](https://docs.signpath.io/artifact-configuration/),
[project and submitter settings](https://docs.signpath.io/projects).
