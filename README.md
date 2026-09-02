# Jupyter Server Explorer

Jupyter Server Explorer is a VS Code extension, displayed as **Jupyter Remote Files**, that exposes files from a remote Jupyter server as a normal VS Code filesystem. It communicates through Jupyter's public HTTP APIs—SSH is not required.

```text
VS Code Explorer / editors        Microsoft Jupyter extension
             │                              │
   jupyter:// filesystem                 kernels
             │                              │
        Contents REST API             HTTP/WebSocket
             └────────── Jupyter Server ────┘
```

The remote Jupyter server remains authoritative. The extension does not keep a permanent local editing copy.

## Features

- Add and remove multiple Jupyter servers.
- Token and standard Jupyter Server password authentication, with credentials stored only in VS Code `SecretStorage`.
- Update the authentication method, password, or token for any saved server from its context menu.
- Recursively browse the Jupyter Contents Manager root in the **Jupyter Servers** Explorer view.
- Add a `jupyter://<server-id>/` root as a VS Code workspace folder.
- Read, create, edit, save, rename, and delete files and directories.
- Round-trip binary files through the Contents API's base64 format.
- Open `.ipynb` files with VS Code's native notebook editor and save notebook JSON back to the original remote path.
- Manually refresh after files are changed by another client.

Only paths exposed by the server's configured Contents Manager are visible. This extension does not grant arbitrary access to the Jupyter host filesystem.

## Requirements

- VS Code 1.95 or newer.
- A reachable Jupyter Server with its Contents API enabled.
- The Microsoft Jupyter extension, installed automatically as a dependency.
- A Jupyter token, a standard single-user Jupyter Server password, or a server with authentication disabled.

## Installation

Until a Marketplace release is available, install a packaged VSIX from the repository:

```sh
git clone https://github.com/easare377/Jupyter-Server-Explorer.git
cd Jupyter-Server-Explorer
pnpm install
pnpm run package
code --install-extension vscode-jupyter-remote-0.1.3.vsix
```

Alternatively, in VS Code run **Extensions: Install from VSIX...** and select the generated `vscode-jupyter-remote-0.1.3.vsix` file. Reload VS Code after installation.

## Connect to a server

1. Open the Explorer and find **Jupyter Servers**.
2. Select the **+** button or run **Jupyter Remote: Add Server** from the Command Palette.
3. Enter a display name and either the Jupyter base URL or a full `/tree`, `/lab`, or `/notebooks` browser URL. For example, `https://jupyter.example.com/lab?token=…` is normalized automatically.
4. Choose **Token**, **Password**, or **None**. Tokens included in a URL are removed before server metadata is stored. Tokens and passwords are stored in VS Code `SecretStorage`.
5. Expand the server in the tree, or right-click it and choose **Jupyter Remote: Open Remote Folder**.

To replace a token or password, or switch authentication methods, right-click the saved server and choose **Jupyter Remote: Update Credentials**. The extension tests the replacement and can restore the previous credential if the test fails.

For a server mounted below a URL prefix, the prefix is preserved. For example, `https://example.test/user/alice/lab` becomes `https://example.test/user/alice/`.

## Run from source

Requirements: Node.js 20+, pnpm, VS Code 1.95 or newer, and the Microsoft Jupyter extension for the notebook experience.

```sh
pnpm install
pnpm run compile
```

Open the cloned directory in VS Code and press `F5` to launch an Extension Development Host.

## Notebook execution

The extension owns remote file access; Microsoft’s Jupyter extension owns kernel discovery and execution. Saved servers are contributed to Microsoft's stable Jupyter server-collection API. After opening a remote `.ipynb`:

1. Use the notebook kernel picker.
2. Choose **Select Another Kernel…** if necessary.
3. Choose **Jupyter Remote Servers**.
4. Choose the saved server, then select one of its remote kernels.

The notebook document is still backed by its `jupyter://` URI. Saving it invokes this extension's filesystem provider and updates the remote notebook through `PUT /api/contents/<path>`.

The integration uses the documented `@vscode/jupyter-extension` API and does not call private Jupyter extension commands. Token connections pass the token; password connections pass the authenticated cookie and XSRF headers obtained from Jupyter's standard login form. **Existing Jupyter Server** remains a fallback if the contributed collection is unavailable.

## API mappings

| VS Code operation | Jupyter Server request |
| --- | --- |
| `stat` | `GET /api/contents/<path>?content=0` |
| `readDirectory` | `GET /api/contents/<path>?content=1` |
| `readFile` | `GET /api/contents/<path>?content=1` |
| `writeFile` | `PUT /api/contents/<path>` |
| `createDirectory` | `PUT /api/contents/<path>` with `type: directory` |
| `rename` | `PATCH /api/contents/<old-path>` with the new `path` |
| `delete` | `DELETE /api/contents/<path>` |

Non-notebook writes use base64, which avoids corrupting binary data. Notebook writes use Jupyter's `type: notebook`, `format: json` model.

## Validation

```sh
pnpm run check
pnpm run lint
pnpm test
pnpm run package
```

The unit tests exercise token replacement, password login cookies, XSRF headers, expired-session reauthentication, base-path and escaped-path request construction, binary reads, notebook writes, rename, delete, and error propagation.

### Real-server checklist

Use a disposable directory under the Jupyter Contents Manager root.

1. Add the server with a token and confirm the connection test succeeds.
2. Expand nested directories in **Jupyter Servers**.
3. Open a text file, edit it, save, and verify the server-side file changed.
4. Create a file and directory from the workspace Explorer.
5. Rename and delete them, then verify the operations remotely.
6. Open a small binary file and confirm a read/write round trip preserves its checksum.
7. Open an `.ipynb`, edit a cell, save, reload, and confirm the remote notebook changed.
8. Select an existing-server kernel through the Microsoft Jupyter extension and run a cell.
9. Use **Update Credentials** to replace the token, verify the test succeeds, then restore the original token.
10. On a disposable password-protected single-user server, repeat file and kernel tests using **Password** authentication.

## Limitations

- The Contents API does not provide a general filesystem change stream. Changes made through this extension emit VS Code filesystem events; changes made elsewhere require **Jupyter Remote: Refresh**.
- Password authentication supports the standard single-user Jupyter Server login form. JupyterHub username/password, OAuth, SSO, and other interactive identity providers are not supported.
- Reads use the general `jupyterRemote.requestTimeout` setting (30 seconds by default). Writes use `jupyterRemote.writeRequestTimeout` (180 seconds by default) because server-side notebook validation, checkpoints, and save hooks can be substantially slower.
- Recursive deletion is implemented client-side because the stable Contents API delete operation has no recursive flag.
- Copy, drag-and-drop upload, search indexing, terminals, and caching are future work.
- HTTPS servers must present a certificate trusted by the VS Code extension host.

## Security

Server names, base URLs, IDs, and authentication type are stored in VS Code global state. Tokens and passwords are stored separately in encrypted `SecretStorage`; neither is written to settings, logs, workspace files, or URI authorities. Tokens use the standard `Authorization: token …` header. Passwords are submitted only to the server's `/login` form; the resulting login and XSRF cookies are kept in memory and sent to the Contents API and Microsoft Jupyter extension.

Jupyter content write permission can modify or delete everything visible under the configured Contents Manager root. Connect only to servers you trust, prefer HTTPS across untrusted networks, and give credentials the minimum permissions your deployment supports. Passwords sent to an `http://` server are not protected by TLS; the extension warns before enabling that configuration.

## References

- [VS Code FileSystemProvider API](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider)
- [VS Code SecretStorage guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions#persisting-secrets)
- [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/stable/developers/rest-api.html)
- [Microsoft Jupyter extension API overview](https://github.com/microsoft/vscode-jupyter/wiki/Extension-API)

## License

Licensed under the [Apache License 2.0](LICENSE).
