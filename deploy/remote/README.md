# JobFlow remote service templates

Development-only. The CLI stack uses development credentials and can publish
ports on all host interfaces. Before starting, configure and independently test
Docker-aware network isolation for every published port. An SSH tunnel does not
restrict direct access to those ports. Prefer Supabase Cloud for the live service.

These templates run the local Supabase stack on a separate Linux host while the
Chrome extension continues to use its existing exact local origin,
`http://127.0.0.1:54321`. The browser reaches the remote API through an SSH
local forward; no private-LAN origin is added to the extension manifest.

See [the remote deployment guide](../../docs/remote-deployment.md) for the
installation sequence and the safety boundaries. `install-user-services.sh`
only prepares a runtime directory and user-level systemd units. It does not
connect to a host, copy credentials, reset a database, or delete Docker data.

`install-supabase-cli.sh` downloads the pinned CLI into the service directory;
it verifies the archive against the release's SHA-256 checksums over HTTPS before
installing the executable. This is integrity verification, not an independent
signature check. It requires Linux and sha256sum, and does not change a
system-wide installation.

The systemd templates require `/usr/bin/sg`, Docker socket access via the `docker`
group, and an already managed Docker daemon. Paths are restricted to absolute
ASCII paths without whitespace or shell/systemd metacharacters. There is one
fixed pair of JobFlow user units; these scripts do not manage multiple instances.

The installer also places a short copy of the start/stop/tunnel instructions at
`~/service/jobflow-browser-extension/README.md` on first install.

After installation, `start.sh`, `stop.sh`, and `status.sh` are convenience
wrappers around the generated user services. The individual
`start-supabase.sh` and `start-model-gateway.sh` scripts are called by systemd;
they are not a substitute for the service dependency ordering.

Run the offline lifecycle/configuration regression with:

```bash
npm run test:deploy
```

This test mocks Supabase, systemctl, and curl; it never contacts a running service.
