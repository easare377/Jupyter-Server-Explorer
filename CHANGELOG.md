# Changelog

## 0.1.3

- Added standard single-user Jupyter Server password authentication using login cookies and XSRF protection.
- Added automatic one-time password-session renewal after an authentication failure.
- Added **Jupyter Remote: Update Credentials** to replace a password or token, switch authentication methods, test the replacement, and restore the previous credential when needed.
- Added password-authenticated remote-kernel integration through the stable Microsoft Jupyter server-collection API.
- Added a warning before transmitting a password to a non-TLS `http://` server.

## 0.1.2

- Added a separate 180-second write timeout for slow notebook saves, configurable with `jupyterRemote.writeRequestTimeout`.
- Integrated saved servers with Microsoft Jupyter's stable server-collection API so their remote kernels appear under **Jupyter Remote Servers** in the notebook kernel picker.
- Changed the Microsoft Jupyter extension from an optional extension-pack entry to a required extension dependency.

## 0.1.1

- Accept full Jupyter `/tree`, `/lab`, and `/notebooks` browser URLs and infer the REST API base URL.
- Recover previously saved `/tree` server URLs when loading server configuration.
- Ignore an accidental trailing comma on a pasted generated hexadecimal token.

## 0.1.0

- Initial testable V1.
- Added token-secured Jupyter server management.
- Added the `jupyter://` filesystem provider and Jupyter Servers Explorer view.
- Added text, binary, directory, and notebook read/write operations through the Jupyter Contents API.
- Added native VS Code notebook opening and documented remote-kernel selection through the Microsoft Jupyter extension.
