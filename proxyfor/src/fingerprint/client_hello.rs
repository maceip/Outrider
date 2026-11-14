//! JA4-style (documented local variant), never mislabeled as an official JA4 hash.
use anyhow::{Result,ensure,Context};
use serde::{Serialize,Deserialize};
use sha2::{Sha256,Digest};
use tokio::io::{AsyncRead,AsyncReadExt};
#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct ClientHello {pub version:u16,pub ciphers:Vec<u16>,pub extensions:Vec<u16>,pub alpn:Vec<String>,pub sni:Option<String>,pub signature_algorithms:Vec<u16>,pub fingerprint:String}
fn grease(v:u16)->bool {v & 0x0f0f == 0x0a0a && v>>8 == v & 255}
struct Reader<'a>(&'a [u8]);
impl<'a> Reader<'a> {
 fn take(&mut self,n:usize)->Result<&'a [u8]> {ensure!(self.0.len()>=n,"Truncated ClientHello");let (a,b)=self.0.split_at(n);self.0=b;Ok(a)}
 fn u8(&mut self)->Result<usize>{Ok(self.take(1)?[0] as usize)}
 fn u16(&mut self)->Result<u16>{let b=self.take(2)?;Ok(u16::from_be_bytes([b[0],b[1]]))}
 fn vec8(&mut self)->Result<&'a[u8]>{let n=self.u8()?;self.take(n)}
 fn vec16(&mut self)->Result<&'a[u8]>{let n=self.u16()? as usize;self.take(n)}
}
fn words(bytes:&[u8])->Result<Vec<u16>> {ensure!(bytes.len()%2==0,"Odd TLS word vector");Ok(bytes.chunks_exact(2).map(|b|u16::from_be_bytes([b[0],b[1]])).collect())}
/// Reassemble complete handshake TLS records. None means more bytes are needed.
pub fn handshake(raw:&[u8])->Result<Option<Vec<u8>>> {
 let mut offset=0;let mut body=Vec::new();
 while raw.len()>=offset+5 {
  ensure!(raw[offset]==22,"Expected TLS handshake record");
  let n=u16::from_be_bytes([raw[offset+3],raw[offset+4]]) as usize;
  ensure!(n<=18432,"Oversized TLS record");
  if raw.len()<offset+5+n{return Ok(None)}
  body.extend_from_slice(&raw[offset+5..offset+5+n]);offset+=5+n;
  if body.len()>=4 {ensure!(body[0]==1,"Expected ClientHello");let len=((body[1]as usize)<<16)|((body[2]as usize)<<8)|body[3]as usize;ensure!(len<=65536,"Oversized ClientHello");if body.len()>=len+4{return Ok(Some(body[4..len+4].to_vec()))}}
 }
 Ok(None)
}
pub fn parse(raw:&[u8])->Result<ClientHello> {
 let bytes=handshake(raw)?.context("Incomplete ClientHello")?;let mut r=Reader(&bytes);
 let mut version=r.u16()?;r.take(32)?;r.vec8()?;let ciphers=words(r.vec16()?)?;r.vec8()?;
 let mut extensions=Vec::new();let mut alpn=Vec::new();let mut sni=None;let mut signature_algorithms=Vec::new();
 if !r.0.is_empty() {let mut ext=Reader(r.vec16()?);while !ext.0.is_empty() {
  let kind=ext.u16()?;let data=ext.vec16()?;ensure!(!extensions.contains(&kind),"Duplicate ClientHello extension");extensions.push(kind);let mut v=Reader(data);
  match kind {0=>{let mut names=Reader(v.vec16()?);while !names.0.is_empty(){let t=names.u8()?;let name=names.vec16()?;if t==0{sni=Some(std::str::from_utf8(name)?.to_owned())}}},
  16=>{let mut protocols=Reader(v.vec16()?);while !protocols.0.is_empty(){alpn.push(std::str::from_utf8(protocols.vec8()?)?.to_owned())}},
  13=>signature_algorithms=words(v.vec16()?)?,
  43=>{let versions=words(v.vec8()?)?;if let Some(max)=versions.into_iter().filter(|v|!grease(*v)).max(){version=max}},_=>{}}
 }}
 ensure!(r.0.is_empty(),"Trailing ClientHello bytes");
 let mut hello=ClientHello{version,ciphers,extensions,alpn,sni,signature_algorithms,fingerprint:String::new()};hello.fingerprint=fingerprint(&hello);Ok(hello)
}
fn hash12(s:&str)->String {format!("{:x}",Sha256::digest(s.as_bytes()))[..12].into()}
fn list(values:impl Iterator<Item=u16>)->String {values.map(|v|format!("{v:04x}")).collect::<Vec<_>>().join(",")}
pub fn fingerprint(h:&ClientHello)->String {
 let mut c:Vec<_>=h.ciphers.iter().copied().filter(|v|!grease(*v)).collect();c.sort_unstable();
 let filtered:Vec<_>=h.extensions.iter().copied().filter(|v|!grease(*v)).collect();let mut e:Vec<_>=filtered.iter().copied().filter(|v|*v!=0 && *v!=16).collect();e.sort_unstable();
 let alpn=h.alpn.first().filter(|s|!s.is_empty()).map(|s|format!("{}{}",s.chars().next().unwrap(),s.chars().last().unwrap())).unwrap_or_else(||"00".into());
 let version=match h.version {0x0304=>"13",0x0303=>"12",0x0302=>"11",0x0301=>"10",_=>"00"};
 format!("t{}{}{:02}{:02}{}_{}_{}",version,if h.sni.is_some(){"d"}else{"i"},c.len().min(99),filtered.len().min(99),alpn,hash12(&list(c.into_iter())),hash12(&format!("{}_{}",list(e.into_iter()),list(h.signature_algorithms.iter().copied().filter(|v|!grease(*v))))))
}
/// Read only until ClientHello completion, then replay all captured bytes to rustls.
pub async fn capture<I:AsyncRead+Unpin>(stream:&mut I)->Vec<u8> {
 let mut raw=Vec::new();let mut buffer=[0u8;4096];
 loop {match handshake(&raw){Ok(Some(_))|Err(_)=>break,_=>{}}
  if raw.len()>=131072{break}
  match tokio::time::timeout(std::time::Duration::from_secs(5),stream.read(&mut buffer)).await {Ok(Ok(n)) if n>0=>raw.extend_from_slice(&buffer[..n]),_=>break}
 }
 raw
}
