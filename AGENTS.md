# Contributor guidance

This extension maps VS Code filesystem calls to the public Jupyter Server Contents API. Keep the remote Jupyter server authoritative: never introduce a permanent local working copy for editing.

## Invariants

- Do not add SSH or host-filesystem assumptions.
- Store tokens and passwords only through `vscode.SecretStorage`; stored server metadata must never contain credentials.
- Keep the `jupyter://<server-id>/<path>` URI shape backward compatible.
- Prefer stable VS Code and Jupyter Server APIs. Do not call private Microsoft Jupyter extension commands or APIs.
- Treat the configured Jupyter Contents Manager root as the complete accessible filesystem boundary.
- Preserve binary data by using base64 with the Contents API.
- Serialize `.ipynb` resources as notebook JSON so VS Code's native notebook editor can read and save them through the filesystem provider.

## Validation

Use pnpm and run, in order:

```sh
pnpm install
pnpm run check
pnpm run lint
pnpm test
pnpm run package
```

Add unit coverage for request mappings and path handling. For provider or UI changes, also follow the manual real-server checklist in `README.md`.
