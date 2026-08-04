# Task brief: explain rejected image uploads before submission

## Outcome

When a user selects an image larger than the supported limit, the settings screen should explain the limit immediately and prevent the doomed upload request. Valid images should continue through the existing upload flow unchanged.

## Why this matters

Users currently wait for an upload that the API will reject. Support has received six reports this month, all from the profile settings screen.

## Current behavior and evidence

- Images above 5 MB enter the normal upload state.
- `POST /api/avatar` returns `413` after the browser sends the file.
- The UI replaces the upload control with the generic message “Something went wrong.”
- Reproduces in production and local development with a 6.2 MB JPEG.
- Valid JPEG and PNG files under 5 MB upload successfully.

## Relevant context

- Likely UI entry point: `src/settings/avatar-form.tsx`
- Upload client: `src/lib/upload-avatar.ts`
- API size limit: `src/api/avatar.ts`
- Existing tests: `src/settings/avatar-form.test.tsx`
- The API limit is authoritative and must remain 5 MB.

## Scope

### In scope

- Validate the selected file size before starting the request.
- Explain that profile images must be 5 MB or smaller.
- Preserve the server-side limit.
- Add regression coverage for an oversized file.

### Out of scope

- Image compression or resizing.
- Changes to accepted file types.
- Redesigning the upload control.
- Other file upload surfaces.

## Constraints

- The file input must remain keyboard accessible.
- Error text must be announced by the existing live region.
- Reuse the API limit constant if it can be imported without moving server-only code into the client bundle; otherwise document why values remain separate.
- Do not add a dependency.

## Definition of done

- [ ] Selecting a file above 5 MB shows the specific limit before submission.
- [ ] No upload request is made for that file.
- [ ] Selecting a valid file after an invalid file clears the error and uploads normally.
- [ ] Focus and screen-reader behavior remain correct.
- [ ] Focused tests, typecheck, and lint pass.

## Verification

```sh
npm test -- avatar-form
npm run typecheck
npm run lint
```

Manual acceptance checks:

1. Select a 6 MB JPEG and confirm the specific error appears without a network request.
2. Then select a 1 MB JPEG and confirm the error clears and the upload succeeds.
3. Repeat using only the keyboard and confirm the live region announces the error.

## Do not change

- The 5 MB API limit.
- The avatar endpoint contract.
- File-type validation or unrelated settings UI.

## Unknowns and assumptions

- Unknown: whether the client and API already share a browser-safe constants module.
- Safe working assumption: the existing live region is the correct error surface.
- Stop and ask if satisfying the task requires changing the endpoint contract or moving server-only code into the client bundle.

## Delivery notes

Report the chosen source for the 5 MB value, the regression test added, all checks run, and any remaining mismatch risk between client and server validation.
