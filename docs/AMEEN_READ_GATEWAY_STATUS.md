# Ameen Read Gateway status

- Windows worker authenticated through the Edge Broker.
- `health` completed end-to-end against Ameen database `AmnDb002`.
- SQL gateway is allow-listed to `health`, `stock`, and `customers` and rejects write/admin SQL tokens.
- SQL connection string remains on the Windows machine only.
- Browser client uses the authenticated Supabase session.
- Windows runtime compatibility uses `ExecuteReader()` after static read-only validation.

Validated before merge into `main`.
