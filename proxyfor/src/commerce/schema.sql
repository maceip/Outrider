CREATE TABLE IF NOT EXISTS fingerprint_observations (
 observation_id TEXT PRIMARY KEY,session_id TEXT REFERENCES agent_sessions,connection_id TEXT,
 kind TEXT NOT NULL,evidence TEXT NOT NULL CHECK(json_valid(evidence)),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS probe_runs (
 probe_id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES agent_sessions,purpose TEXT NOT NULL,
 status TEXT NOT NULL,latency_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,
 structural_compliance INTEGER,response TEXT,error TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS upstream_servers (
 name TEXT PRIMARY KEY,endpoint TEXT NOT NULL,status TEXT NOT NULL,error TEXT,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_items (
 item_id TEXT PRIMARY KEY,kind TEXT NOT NULL,digest TEXT NOT NULL,
 descriptor TEXT NOT NULL CHECK(json_valid(descriptor)),upstream_name TEXT REFERENCES upstream_servers(name));
CREATE TABLE IF NOT EXISTS bundles (
 bundle_id TEXT PRIMARY KEY,title TEXT NOT NULL,items TEXT NOT NULL CHECK(json_valid(items)),
 rules TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(rules)));
CREATE TABLE IF NOT EXISTS session_offers (
 offer_id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES agent_sessions,bundle_id TEXT NOT NULL REFERENCES bundles,
 source TEXT NOT NULL,evaluation_id TEXT REFERENCES clef_evaluations,created_at INTEGER NOT NULL,
 UNIQUE(session_id,bundle_id));
CREATE TABLE IF NOT EXISTS mrtr_quotes (
 quote_id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES agent_sessions,subject TEXT NOT NULL,
 bundle_id TEXT NOT NULL REFERENCES bundles,request TEXT NOT NULL CHECK(json_valid(request)),
 item_digests TEXT NOT NULL CHECK(json_valid(item_digests)),expires_at_unix INTEGER NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN(0,1)));
CREATE TABLE IF NOT EXISTS capability_receipts (
 receipt_id TEXT PRIMARY KEY,subject TEXT NOT NULL,bundle_id TEXT NOT NULL REFERENCES bundles,
 payload TEXT NOT NULL CHECK(json_valid(payload)),signature TEXT NOT NULL,
 max_calls INTEGER NOT NULL CHECK(max_calls>0),remaining_calls INTEGER NOT NULL CHECK(remaining_calls>=0),
 expires_at_unix INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS receipt_redemptions (
 redemption_id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL REFERENCES capability_receipts,
 session_id TEXT NOT NULL REFERENCES agent_sessions,tool_name TEXT NOT NULL,quote_id TEXT UNIQUE REFERENCES mrtr_quotes,
 created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS presented_receipts (
 session_id TEXT NOT NULL REFERENCES agent_sessions,receipt_id TEXT NOT NULL REFERENCES capability_receipts,
 PRIMARY KEY(session_id,receipt_id));
CREATE TABLE IF NOT EXISTS admin_audit_log (
 audit_id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT,
 details TEXT NOT NULL CHECK(json_valid(details)),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_frames (
 frame_id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT REFERENCES agent_sessions,
 upstream_name TEXT,direction TEXT NOT NULL,method TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS observation_session ON fingerprint_observations(session_id);
CREATE INDEX IF NOT EXISTS probe_session ON probe_runs(session_id);
CREATE INDEX IF NOT EXISTS evaluation_session ON clef_evaluations(session_id);
CREATE INDEX IF NOT EXISTS receipt_subject ON capability_receipts(subject);
CREATE INDEX IF NOT EXISTS redemption_receipt ON receipt_redemptions(receipt_id);
CREATE TABLE IF NOT EXISTS proxy_traffic (
 id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,traffic_id INTEGER NOT NULL,
 head TEXT NOT NULL CHECK(json_valid(head)),detail TEXT NOT NULL CHECK(json_valid(detail)),
 UNIQUE(run_id,traffic_id));
CREATE TABLE IF NOT EXISTS proxy_websocket_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,websocket_id INTEGER NOT NULL,
 message TEXT NOT NULL CHECK(json_valid(message)),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inspector_connections (
 connection_id TEXT PRIMARY KEY,label TEXT NOT NULL,transport TEXT NOT NULL,target TEXT NOT NULL,
 lifecycle TEXT NOT NULL,header_names TEXT NOT NULL CHECK(json_valid(header_names)),
 env_names TEXT NOT NULL CHECK(json_valid(env_names)),status TEXT NOT NULL,
 server_info TEXT CHECK(server_info IS NULL OR json_valid(server_info)),error TEXT,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inspector_messages (
 message_id INTEGER PRIMARY KEY AUTOINCREMENT,connection_id TEXT NOT NULL REFERENCES inspector_connections,
 direction TEXT NOT NULL,kind TEXT NOT NULL,method TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),
 reply_to INTEGER,latency_ms INTEGER,created_at_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS inspector_message_connection ON inspector_messages(connection_id,message_id);
CREATE TABLE IF NOT EXISTS inspector_server_requests (
 request_id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES inspector_connections,
 method TEXT NOT NULL,params TEXT NOT NULL CHECK(json_valid(params)),status TEXT NOT NULL,
 response TEXT CHECK(response IS NULL OR json_valid(response)),created_at INTEGER NOT NULL,answered_at INTEGER);
CREATE TABLE IF NOT EXISTS commerce_meta (
 key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
