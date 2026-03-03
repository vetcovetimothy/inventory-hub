"use client";
import { useState, useMemo, useCallback, useEffect } from "react";

/* ═══════ STORAGE (localStorage) ═══════ */
function sGet(k) {
  try {
    const raw = localStorage.getItem("vh-cx-" + k);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function sSet(k, v) {
  try { localStorage.setItem("vh-cx-" + k, JSON.stringify(v)); } catch {}
}
function sDel(k) {
  try { localStorage.removeItem("vh-cx-" + k); } catch {}
}

/* ═══════ API HELPER ═══════ */
async function fetchAcumatica(type) {
  const resp = await fetch("/api/acumatica", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, useServiceAccount: true }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || "Acumatica request failed");
  return json.data || [];
}

/* ═══════ ICONS ═══════ */
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconKey() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>; }
function IconBox() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconRefresh() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>; }
function IconTrash() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>; }
function Dot({ color }) { return <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />; }
function Spinner({ color, size }) { return <span style={{ width: size || 14, height: size || 14, border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid " + (color || "#fff"), borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />; }

/* ═══════ STYLES ═══════ */
function makeStyles(accent) {
  return {
    card: { background: "#111520", border: "1px solid #1E2433", borderRadius: 12, padding: 24, marginBottom: 20 },
    btn: function(v) {
      var base = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" };
      if (v === "danger") return Object.assign({}, base, { background: "#EF4444", color: "#fff" });
      if (v === "ghost") return Object.assign({}, base, { background: "transparent", color: "#94A3B8", border: "1px solid #1E2433" });
      return Object.assign({}, base, { background: accent, color: "#fff" });
    },
    inp: { background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none", width: "100%" },
    sel: { background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none" },
    th: { padding: "10px 12px", textAlign: "left", background: "#0D1017", color: "#64748B", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid #1E2433", position: "sticky", top: 0, zIndex: 2 },
    td: { padding: "10px 12px", borderBottom: "1px solid #141822", color: "#CBD5E1" },
    badge: function(t) {
      var base = { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 };
      var colors = { success: ["rgba(16,185,129,0.15)", "#10B981"], danger: ["rgba(239,68,68,0.15)", "#EF4444"], warning: ["rgba(245,158,11,0.15)", "#F59E0B"], purple: ["rgba(139,92,246,0.15)", "#A78BFA"], blue: ["rgba(59,130,246,0.15)", "#60A5FA"] };
      var c = colors[t] || ["rgba(100,116,139,0.15)", "#94A3B8"];
      return Object.assign({}, base, { background: c[0], color: c[1] });
    },
    pill: function(active, col) {
      return { padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6, background: active ? (col || accent) : "transparent", color: active ? "#fff" : "#64748B" };
    },
  };
}

function CopyCell({ text, toast, color }) {
  return (
    <div title={text} onClick={function() { navigator.clipboard.writeText(text); toast("Copied"); }}
      style={{ cursor: "pointer", padding: "2px 6px", borderRadius: 4, userSelect: "all", wordBreak: "break-word", lineHeight: 1.4, color: color || "#CBD5E1" }}>
      {text}
    </div>
  );
}

/* ═══════ CX TRACKER TOOL ═══════ */
function CXTracker(props) {
  var toolKey = props.toolKey, toolLabel = props.toolLabel, toolColor = props.toolColor;
  var columns = props.columns;
  var toast = props.toast;

  var _d = useState([]), data = _d[0], setData = _d[1];
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _q = useState(""), search = _q[0], setSearch = _q[1];
  var _vf = useState("all"), vendorFilter = _vf[0], setVendorFilter = _vf[1];
  var _il = useState(true), initLoading = _il[0], setInitLoading = _il[1];
  var _rt = useState(null), runTime = _rt[0], setRunTime = _rt[1];
  var _cc = useState(false), confirmClear = _cc[0], setConfirmClear = _cc[1];

  var S = useMemo(function() { return makeStyles(toolColor); }, [toolColor]);
  var storageKey = "cx-tracker-" + toolKey;

  useEffect(function() {
    var mounted = true;
    (async function() {
      var saved = sGet(storageKey);
      if (mounted && saved && saved.data && saved.data.length > 0) {
        setData(saved.data); setRunTime(saved.runTime || null);
      }
      if (mounted) setInitLoading(false);
    })();
    return function() { mounted = false; };
  }, [storageKey]);

  var syncData = useCallback(async function() {
    setLoading(true);
    try {
      var rows = await fetchAcumatica(toolKey);
      var now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      setData(rows); setRunTime(now);
      sSet(storageKey, { data: rows, runTime: now });
      toast(toolLabel + ": Synced " + rows.length + " items");
    } catch (err) {
      toast("Error: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast, storageKey, toolLabel, toolKey]);

  var clearAll = useCallback(function() {
    setData([]); setRunTime(null); setConfirmClear(false);
    sDel(storageKey);
    toast(toolLabel + ": Cleared");
  }, [toast, storageKey, toolLabel]);

  var uniqueVendors = useMemo(function() { return Array.from(new Set(data.map(function(r) { return r.VendorName; }))).sort(); }, [data]);

  var filtered = useMemo(function() {
    var d = data.slice();
    if (search) {
      var s = search.toLowerCase();
      d = d.filter(function(r) {
        return columns.some(function(c) { return String(r[c.key] || "").toLowerCase().indexOf(s) >= 0; });
      });
    }
    if (vendorFilter !== "all") d = d.filter(function(r) { return r.VendorName === vendorFilter; });
    return d;
  }, [data, search, vendorFilter, columns]);

  var ToolIcon = toolKey === "backorder" ? IconBox : IconClock;

  if (initLoading) return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#64748B" })}><Spinner color={toolColor} size={20} /></div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }} />
        {runTime && <span style={{ fontSize: 11, color: "#475569" }}>Last synced: {runTime}</span>}
        {data.length > 0 && <span style={S.badge("default")}>{data.length} items</span>}
        {data.length > 0 && (confirmClear
          ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: "#FCA5A5" }}>Clear?</span><button onClick={clearAll} style={Object.assign({}, S.btn("danger"), { padding: "6px 14px", fontSize: 12 })}>Yes</button><button onClick={function() { setConfirmClear(false); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>No</button></div>
          : <button onClick={function() { setConfirmClear(true); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12, color: "#64748B" })}><IconTrash /> Clear</button>
        )}
      </div>

      <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 16, padding: "16px 24px" })}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: toolColor + "20", display: "flex", alignItems: "center", justifyContent: "center", color: toolColor }}><ToolIcon /></div>
        <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC" }}>{toolLabel}</div><div style={{ fontSize: 12, color: "#64748B" }}>{data.length > 0 ? data.length + " items across " + uniqueVendors.length + " vendors" : "No data synced"}</div></div>
        <button style={Object.assign({}, S.btn(), { padding: "10px 24px" })} onClick={syncData} disabled={loading}>{loading ? <><Spinner /> Syncing...</> : <><IconRefresh /> {data.length > 0 ? "Refresh" : "Load Data"}</>}</button>
      </div>

      {data.length > 0 && <>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
          <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
          <div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: "#64748B" }}>{filtered.length}/{data.length}</span>
        </div>
        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: 500 })}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
            <thead><tr>{columns.map(function(c) { return <th key={c.key} style={Object.assign({}, S.th, c.align === "right" ? { textAlign: "right" } : {})}>{c.label}</th>; })}</tr></thead>
            <tbody>{filtered.map(function(row, idx) {
              var mc = (row.MovementClass || "").toLowerCase();
              var isLT = mc.indexOf("long-term") >= 0;
              return <tr key={idx} style={{ background: isLT ? "rgba(239,68,68,0.04)" : "transparent" }}>{columns.map(function(col) {
                var val = row[col.key] != null ? row[col.key] : "";
                var vs = String(val);
                if (col.copyable) return <td key={col.key} style={Object.assign({}, S.td, { maxWidth: 280 })}><CopyCell text={vs} toast={toast} /></td>;
                if (col.badgeFn) return <td key={col.key} style={S.td}><span style={S.badge(col.badgeFn(vs))}>{vs}</span></td>;
                return <td key={col.key} style={Object.assign({}, S.td, col.mono ? { fontFamily: "monospace", fontSize: 11 } : {}, col.align === "right" ? { textAlign: "right" } : {}, col.bold ? { fontWeight: 600 } : {}, col.highlightColor ? { color: col.highlightColor } : {})}>{vs}</td>;
              })}</tr>;
            })}</tbody>
          </table>
        </div>
      </>}

      {data.length === 0 && !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#475569" })}><ToolIcon /><p style={{ marginTop: 12, fontSize: 14 }}>Click <strong>Load Data</strong> to pull {toolLabel.toLowerCase()} items.</p></div>}
    </div>
  );
}

/* ═══════ MAIN CX HUB ═══════ */
export default function CXHub() {
  var _p = useState("short-dating"), page = _p[0], setPage = _p[1];
  var _t = useState(null), toast = _t[0], setToast = _t[1];
  var _auth = useState(false), authed = _auth[0], setAuthed = _auth[1];
  var _al = useState(true), authLoading = _al[0], setAuthLoading = _al[1];
  var _ll = useState(false), loginLoading = _ll[0], setLoginLoading = _ll[1];
  var _cred = useState({ username: "", password: "" }), cxCred = _cred[0], setCxCred = _cred[1];
  var _err = useState(""), loginErr = _err[0], setLoginErr = _err[1];

  var showToast = useCallback(function(m, t) { setToast({ m: m, t: t || "success" }); setTimeout(function() { setToast(null); }, 3500); }, []);

  // Check if already logged in
  useEffect(function() {
    var saved = sGet("cx-auth");
    if (saved && saved.authed) setAuthed(true);
    setAuthLoading(false);
  }, []);

  var cxLogin = useCallback(async function() {
    setLoginErr("");
    setLoginLoading(true);
    try {
      var resp = await fetch("/api/cx-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cxCred.username, password: cxCred.password }),
      });
      var json = await resp.json();
      if (!resp.ok) { setLoginErr(json.error || "Login failed"); return; }
      sSet("cx-auth", { authed: true });
      setAuthed(true);
      showToast("Logged in");
    } catch (err) {
      setLoginErr("Connection error");
    } finally {
      setLoginLoading(false);
    }
  }, [cxCred, showToast]);

  var cxLogout = useCallback(function() {
    sDel("cx-auth");
    setAuthed(false);
    setCxCred({ username: "", password: "" });
    showToast("Logged out", "info");
  }, [showToast]);

  var sdColumns = useMemo(function() { return [
    { key: "ItemStatus", label: "Status", badgeFn: function(v) { return v.toLowerCase() === "active" ? "success" : "default"; } },
    { key: "Description", label: "Description", copyable: true },
    { key: "VendorName", label: "Vendor" },
    { key: "InventoryID", label: "Inv. ID", mono: true },
    { key: "SKUNDC", label: "SKU/NDC", mono: true },
    { key: "BestKnownDating", label: "Best Dating", highlightColor: "#FCD34D", bold: true },
    { key: "QtyOnHand", label: "Qty", align: "right" },
    { key: "BaseUnit", label: "Unit" },
    { key: "OpenQty", label: "Open", align: "right" },
    { key: "NoteText", label: "Notes" },
  ]; }, []);

  var bkoColumns = useMemo(function() { return [
    { key: "ItemStatus", label: "Status", badgeFn: function(v) { return v.toLowerCase() === "active" ? "success" : "default"; } },
    { key: "MovementClass", label: "Type", badgeFn: function(v) { return v.toLowerCase().indexOf("long-term") >= 0 ? "danger" : "warning"; } },
    { key: "Description", label: "Description", copyable: true },
    { key: "VendorName", label: "Vendor" },
    { key: "InventoryID", label: "Inv. ID", mono: true },
    { key: "SKUNDC", label: "SKU/NDC", mono: true },
    { key: "BaseUnit", label: "Unit" },
    { key: "QtyOnHand", label: "On Hand", align: "right" },
    { key: "OpenQty", label: "Open Qty", align: "right", bold: true },
    { key: "RecoveryDate", label: "Recovery Date", highlightColor: "#60A5FA", bold: true },
  ]; }, []);

  var activeColor = page === "short-dating" ? "#E879F9" : "#F97316";
  var activeLabel = page === "short-dating" ? "Short-Dating Tracker" : "Backorder Tracker";

  if (authLoading) return <div style={{ fontFamily: "sans-serif", background: "#0B0E14", color: "#E2E8F0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner color="#3B82F6" size={24} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  if (!authed) return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#0B0E14", color: "#E2E8F0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.12)}input:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)}`}</style>
      <div style={{ background: "#111520", border: "1px solid #1E2433", borderRadius: 16, padding: 40, width: 420, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}><IconKey /></div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#F8FAFC", margin: "0 0 4px" }}>Inventory Hub</h1>
        <p style={{ fontSize: 11, color: "#64748B", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", margin: "0 0 32px" }}>Customer Support</p>
        <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500, display: "block", marginBottom: 6 }}>Username</label><input style={{ background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "10px 14px", color: "#E2E8F0", fontSize: 14, outline: "none", width: "100%" }} value={cxCred.username} onChange={function(e) { setCxCred({ username: e.target.value, password: cxCred.password }); setLoginErr(""); }} placeholder="Username" /></div>
          <div><label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500, display: "block", marginBottom: 6 }}>Password</label><input style={{ background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "10px 14px", color: "#E2E8F0", fontSize: 14, outline: "none", width: "100%" }} type="password" value={cxCred.password} onChange={function(e) { setCxCred({ username: cxCred.username, password: e.target.value }); setLoginErr(""); }} placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} onKeyDown={function(e) { if (e.key === "Enter") cxLogin(); }} /></div>
          {loginErr && <div style={{ fontSize: 12, color: "#EF4444", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>{loginErr}</div>}
          <button onClick={cxLogin} disabled={loginLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "12px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8, opacity: loginLoading ? 0.7 : 1 }}>{loginLoading ? <><Spinner /> Signing in...</> : <><IconKey /> Sign In</>}</button>
        </div>
      </div>
    </div>
  );

  function SideLink(p) {
    var active = page === p.id;
    return <div onClick={function() { setPage(p.id); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", fontSize: 14, cursor: "pointer", transition: "all 0.15s", fontWeight: active ? 600 : 400, color: active ? "#F8FAFC" : "#94A3B8", background: active ? p.color + "15" : "transparent", borderRight: active ? "2px solid " + p.color : "2px solid transparent" }}><Dot color={p.color} />{p.label}</div>;
  }

  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#0B0E14", color: "#E2E8F0", minHeight: "100vh", display: "flex" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0B0E14}::-webkit-scrollbar-thumb{background:#1E2433;border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.12)}input:focus,select:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)}tr:hover td{background:rgba(59,130,246,0.04)}`}</style>

      <div style={{ width: 240, background: "#111520", borderRight: "1px solid #1E2433", display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0 }}>
        <div style={{ padding: "0 24px 24px", borderBottom: "1px solid #1E2433", marginBottom: 12 }}>
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px", color: "#F8FAFC", margin: 0 }}>Inventory Hub</p>
          <p style={{ fontSize: 11, color: "#64748B", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 4 }}>Customer Support</p>
        </div>
        <div style={{ padding: "0 12px", marginBottom: 4 }}><div style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>Inventory Tools</div></div>
        <SideLink id="short-dating" label="Short-Dating" color="#E879F9" />
        <SideLink id="backorder" label="Backorders" color="#F97316" />
        <div style={{ flex: 1 }} />
        <div style={{ padding: "0 16px" }}>
          <div style={{ padding: "12px 16px", background: "rgba(59,130,246,0.08)", borderRadius: 10, border: "1px solid rgba(59,130,246,0.2)" }}>
            <div style={{ fontSize: 12, color: "#93C5FD", fontWeight: 500 }}>CX View</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>Read-only inventory data</div>
            <button onClick={cxLogout} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "transparent", color: "#94A3B8", border: "1px solid #1E2433", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>Logout</button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        <div style={{ padding: "16px 32px", borderBottom: "1px solid #1E2433", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0D1017" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Dot color={activeColor} /><span style={{ fontSize: 18, fontWeight: 600, color: "#F8FAFC" }}>{activeLabel}</span></div>
          <span style={{ fontSize: 12, color: "#64748B" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        </div>
        <div style={{ padding: 32, flex: 1 }}>
          {page === "short-dating" && <CXTracker toolKey="short-dating" toolLabel="Short-Dating Tracker" toolColor="#E879F9" columns={sdColumns} toast={showToast} />}
          {page === "backorder" && <CXTracker toolKey="backorder" toolLabel="Backorder Tracker" toolColor="#F97316" columns={bkoColumns} toast={showToast} />}
        </div>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#065F46" : "#1E293B", color: "#F8FAFC", border: "1px solid " + (toast.t === "success" ? "#10B981" : "#334155"), boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );
}
