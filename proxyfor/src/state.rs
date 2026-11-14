use crate::{
    server::PrintMode,
    traffic::{Body, Traffic, TrafficHead, wrap_entries},
};

use anyhow::{Result, anyhow, bail};
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value;
use time::OffsetDateTime;
use tokio::{sync::Mutex, sync::broadcast};
use tokio_tungstenite::tungstenite;

#[derive(Debug)]
pub struct State {
    pub commerce:std::sync::OnceLock<std::sync::Arc<crate::commerce::Commerce>>,
    print_mode: PrintMode,
    traffics: Mutex<IndexMap<usize, Traffic>>,
    traffics_notifier: broadcast::Sender<TrafficHead>,
    websockets: Mutex<IndexMap<usize, Vec<WebsocketMessage>>>,
    websockets_notifier: broadcast::Sender<(usize, WebsocketMessage)>,
}

impl State {
    pub fn new(print_mode: PrintMode) -> Self {
        let (traffics_notifier, _) = broadcast::channel(128);
        let (websockets_notifier, _) = broadcast::channel(64);
        Self {
            commerce:Default::default(),
            print_mode,
            traffics: Default::default(),
            traffics_notifier,
            websockets: Default::default(),
            websockets_notifier,
        }
    }

    fn report_persistence_error(&self,error:anyhow::Error) {
        error!("Commerce persistence failed: {error:#}");
        if let Some(c)=self.commerce.get() {let mut errors=c.errors.lock().unwrap();errors.push(format!("{error:#}"));if errors.len()>50 {errors.remove(0);}c.changed("persistence.error",None);}
    }
    async fn persist_traffic(&self,id:usize,traffic:&Traffic) {
        let Some(c)=self.commerce.get() else{return};
        let result=(||->Result<()> {
            let head=serde_json::to_string(&traffic.head(id))?;
            let detail=serde_json::to_string(traffic)?;
            c.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("INSERT INTO proxy_traffic(run_id,traffic_id,head,detail) VALUES (?1,?2,?3,?4) ON CONFLICT(run_id,traffic_id) DO UPDATE SET head=excluded.head,detail=excluded.detail",rusqlite::params![c.run_id,id as i64,head,detail])?;Ok(())
        })();
        if let Err(error)=result {self.report_persistence_error(error);return}
        // Persist bodies once they have actually been read from completed capture files.
        if traffic.end_time.is_some() {
            match traffic.export("").await {
                Ok((detail,_))=>{let result=c.db.0.lock().map_err(|_|anyhow!("database lock poisoned")).and_then(|conn|Ok(conn.execute("UPDATE proxy_traffic SET detail=?3 WHERE run_id=?1 AND traffic_id=?2",rusqlite::params![c.run_id,id as i64,detail])?));if let Err(error)=result {self.report_persistence_error(error);}},
                Err(error)=>self.report_persistence_error(error),
            }
        }
        c.changed("traffic.persisted",None);
    }
    fn persist_websocket(&self,id:usize,message:&WebsocketMessage) {
        let Some(c)=self.commerce.get() else{return};
        let result=(||->Result<()> {c.db.0.lock().map_err(|_|anyhow!("database lock poisoned"))?.execute("INSERT INTO proxy_websocket_messages(run_id,websocket_id,message,created_at) VALUES (?1,?2,?3,?4)",rusqlite::params![c.run_id,id as i64,serde_json::to_string(message)?,crate::commerce::db::now()])?;Ok(())})();
        if let Err(error)=result {self.report_persistence_error(error);}else{c.changed("websocket.persisted",None);}
    }

    pub async fn add_traffic(&self, traffic: Traffic) {
        if !traffic.valid {
            return;
        }
        let mut traffics = self.traffics.lock().await;
        let id = traffics.len() + 1;
        let head = traffic.head(id);
        self.persist_traffic(id,&traffic).await;
        traffics.insert(id, traffic);
        let _ = self.traffics_notifier.send(head);
    }

    pub async fn done_traffic(&self, gid: usize, raw_size: u64) {
        let mut traffics = self.traffics.lock().await;
        let Some((id, traffic)) = traffics.iter_mut().find(|(_, v)| v.gid == gid) else {
            return;
        };

        traffic.uncompress_res_file().await;
        traffic.done_res_body(raw_size);

        self.persist_traffic(*id,traffic).await;
        let head = traffic.head(*id);
        let _ = self.traffics_notifier.send(head);
        match self.print_mode {
            PrintMode::Nothing => {}
            PrintMode::Oneline => {
                println!("# {}", traffic.oneline());
            }
            PrintMode::Markdown => {
                println!("{}", traffic.markdown().await);
            }
        }
    }

    pub async fn get_traffic(&self, id: usize) -> Option<Traffic> {
        let traffics = self.traffics.lock().await;
        traffics.get(&id).cloned()
    }

    pub fn subscribe_traffics(&self) -> broadcast::Receiver<TrafficHead> {
        self.traffics_notifier.subscribe()
    }

    pub async fn list_heads(&self) -> Vec<TrafficHead> {
        let traffics = self.traffics.lock().await;
        traffics
            .iter()
            .map(|(id, traffic)| traffic.head(*id))
            .collect()
    }

    pub async fn export_traffic(&self, id: usize, format: &str) -> Result<(String, &'static str)> {
        let traffic = self
            .get_traffic(id)
            .await
            .ok_or_else(|| anyhow!("Not found traffic {id}"))?;
        traffic.export(format).await
    }

    pub async fn export_all_traffics(&self, format: &str) -> Result<(String, &'static str)> {
        let traffics = self.traffics.lock().await;
        match format {
            "markdown" => {
                let output =
                    futures_util::future::join_all(traffics.iter().map(|(_, v)| v.markdown()))
                        .await
                        .into_iter()
                        .collect::<Vec<String>>()
                        .join("\n\n");
                Ok((output, "text/markdown; charset=UTF-8"))
            }
            "har" => {
                let values: Vec<Value> =
                    futures_util::future::join_all(traffics.iter().map(|(_, v)| v.har_entry()))
                        .await
                        .into_iter()
                        .flatten()
                        .collect();
                let json_output = wrap_entries(values);
                let output = serde_json::to_string_pretty(&json_output)?;
                Ok((output, "application/json; charset=UTF-8"))
            }
            "curl" => {
                let output = futures_util::future::join_all(traffics.iter().map(|(_, v)| v.curl()))
                    .await
                    .into_iter()
                    .collect::<Vec<String>>()
                    .join("\n\n");
                Ok((output, "text/plain; charset=UTF-8"))
            }
            "json" => {
                let values = futures_util::future::join_all(traffics.iter().map(|(_, v)| v.json()))
                    .await
                    .into_iter()
                    .collect::<Vec<Value>>();
                let output = serde_json::to_string_pretty(&values)?;
                Ok((output, "application/json; charset=UTF-8"))
            }
            "" => {
                let values = traffics
                    .iter()
                    .map(|(id, traffic)| traffic.head(*id))
                    .collect::<Vec<TrafficHead>>();
                let output = serde_json::to_string_pretty(&values)?;
                Ok((output, "application/json; charset=UTF-8"))
            }
            _ => bail!("Unsupported format: {}", format),
        }
    }

    pub async fn new_websocket(&self) -> usize {
        let mut websockets = self.websockets.lock().await;
        let id = websockets.len() + 1;
        websockets.insert(id, vec![]);
        id
    }

    pub async fn add_websocket_error(&self, id: usize, error: String) {
        let mut websockets = self.websockets.lock().await;
        let Some(messages) = websockets.get_mut(&id) else {
            return;
        };
        let message = WebsocketMessage::Error(error);
        self.persist_websocket(id,&message);
        messages.push(message.clone());
        let _ = self.websockets_notifier.send((id, message));
    }

    pub async fn add_websocket_message(
        &self,
        id: usize,
        message: &tungstenite::Message,
        server_to_client: bool,
    ) {
        let mut websockets = self.websockets.lock().await;
        let Some(messages) = websockets.get_mut(&id) else {
            return;
        };
        let body = match message {
            tungstenite::Message::Text(text) => Body::text(text),
            tungstenite::Message::Binary(bin) => Body::bytes(bin),
            _ => return,
        };
        let message = WebsocketMessage::Data(WebsocketData {
            create: OffsetDateTime::now_utc(),
            server_to_client,
            body,
        });
        self.persist_websocket(id,&message);
        messages.push(message.clone());
        let _ = self.websockets_notifier.send((id, message));
    }

    pub async fn subscribe_websocket(&self, id: usize) -> Option<SubscribedWebSocket> {
        let websockets = self.websockets.lock().await;
        let messages = websockets.get(&id)?;
        Some((messages.to_vec(), self.websockets_notifier.subscribe()))
    }
}

pub type SubscribedWebSocket = (
    Vec<WebsocketMessage>,
    broadcast::Receiver<(usize, WebsocketMessage)>,
);

#[derive(Debug, Clone, Serialize)]
pub enum WebsocketMessage {
    #[serde(rename = "error")]
    Error(String),
    #[serde(rename = "data")]
    Data(WebsocketData),
}

#[derive(Debug, Clone, Serialize)]
pub struct WebsocketData {
    #[serde(serialize_with = "crate::utils::serialize_datetime")]
    pub create: OffsetDateTime,
    pub server_to_client: bool,
    pub body: Body,
}
