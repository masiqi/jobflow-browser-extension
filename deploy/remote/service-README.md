# JobFlow Remote Service

Development-only Supabase CLI stack. Default credentials and Docker-published
ports are not safe on an untrusted network. Establish and test Docker-aware
network isolation before starting any service. The SSH tunnel below does not
hide ports bound to all interfaces. Use Supabase Cloud for production hosting.

This directory contains the runtime state for the JobFlow Supabase stack.
The source checkout is kept separately at:

```text
~/work/toys/jobflow-browser-extension
```

## Start and Stop

Run these commands from the source checkout:

```bash
cd "$HOME/work/toys/jobflow-browser-extension"
deploy/remote/start.sh
deploy/remote/status.sh
deploy/remote/stop.sh
```

The service uses a separate Supabase project ID and ports. Start and stop only
the JobFlow containers; they do not run `supabase db reset`, delete Docker
volumes, or touch other Supabase projects on this host.

The model-gateway service reads the optional server-only file below:

```text
~/service/jobflow-browser-extension/model-gateway.env
```

Keep that file at mode `0600`. BYOK testing works when it is empty.

## Extension Tunnel

Keep this SSH tunnel open on the development machine while using the extension:

```bash
ssh -o ExitOnForwardFailure=yes -N \
  -L 127.0.0.1:54321:127.0.0.1:15421 \
  REMOTE_USER@REMOTE_HOST
```

The extension then continues to use `http://127.0.0.1:54321`; no LAN IP is
added to its host permissions.

## Logs

```bash
journalctl --user -u jobflow-supabase.service -f
journalctl --user -u jobflow-model-gateway.service -f
```

Do not paste raw `supabase status -o env` output or populated model env files
into chat, issues, or Git. Use `deploy/remote/status.sh` for a redacted status.
