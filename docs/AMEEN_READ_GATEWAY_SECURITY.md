# Security invariants

Ameen access remains read-only. The browser never receives the SQL connection string and cannot submit arbitrary SQL. The Windows worker only executes allow-listed resources through the authenticated broker.
