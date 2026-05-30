"use client";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ═══════ STORAGE (localStorage) ═══════ */
function sGet(k) {
  try {
    const raw = localStorage.getItem("vh-" + k);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function sSet(k, v) {
  try { localStorage.setItem("vh-" + k, JSON.stringify(v)); } catch {}
}
function sDel(k) {
  try { localStorage.removeItem("vh-" + k); } catch {}
}

/* ═══════ KV HELPERS ═══════ */
var KV_SECRET = typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_KV_SECRET || "";
function kvHeaders(extra) {
  var h = Object.assign({ "x-kv-secret": KV_SECRET }, extra || {});
  return h;
}
function kvGet(key) {
  return fetch("/api/kv?key=" + encodeURIComponent(key) + "&_t=" + Date.now(), { cache: "no-store", headers: kvHeaders() });
}
function kvPost(key, value) {
  return fetch("/api/kv", { method: "POST", headers: kvHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ key: key, value: value }) });
}

/* ═══════ API HELPERS ═══════ */
async function fetchAcumatica(type, warehouse, username, password) {
  const resp = await fetch("/api/acumatica", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, warehouse, username, password }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || "Acumatica request failed");
  return json.data || [];
}

async function postGmailDrafts(drafts, refreshToken) {
  const resp = await fetch("/api/gmail-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drafts, refreshToken: refreshToken || undefined }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || "Gmail draft creation failed");
  return json;
}

function getGmailToken() {
  try {
    var g = localStorage.getItem("vh-gmail");
    return g ? JSON.parse(g) : null;
  } catch { return null; }
}

function setGmailToken(token, email) {
  try { localStorage.setItem("vh-gmail", JSON.stringify({ token: token, email: email })); } catch {}
}

function clearGmailToken() {
  try { localStorage.removeItem("vh-gmail"); } catch {}
}

/* ═══════ SHIPPING RULES ═══════ */
const DEFAULT_SHIP_RULES = {
  "American Regent Animal Health": "message:Free Shipping",
  "Boehringer Ingelheim Animal Health": "message:Free Shipping",
  "Ceva Animal Health": "message:Free Shipping",
  "Clipper Distributing Co., LLC": "min:10000; message:Free Shipping; else:Not Free Shipping",
  "Creative Science": "message:Free Shipping",
  "Elanco US Inc.": "message:Free Shipping",
  "Hill's": "message:Free Shipping",
  "Merck Animal Health": "min:5000; message:Free Shipping; else:Not Free Shipping",
  "Neogen Corporation": "range:0-99.99=15%; range:100-1499.99=8%; min:1500; message:Free Shipping",
  "Nipro Medical Corporation": "message:Free Shipping",
  "Nextmune US LLC": "message:Free Shipping",
  "Pet Honesty": "min:1500; message:Free Shipping; else:Will not ship",
  "Phibro": "message:Free Shipping",
  "RX Vitamins": "min:300; message:Free Shipping; else:Not Free Shipping",
  "Trudell": "message:Free Shipping",
  "UltiMed, Inc.": "min:2500; message:Free Shipping; else:Not Free Shipping",
  "Vet Brands International, Inc.": "min:1500; message:Free Shipping; else:Not Free Shipping",
  "Vetoquinol USA": "message:Free Shipping",
  "Vetnique": "min:500; message:Free Shipping; else:Not Free Shipping",
  "Food Science LLC": "message:Free Shipping",
  "VetriScience": "message:Free Shipping",
  "VetriMax": "min:2200; message:Free Shipping; else:Not Free Shipping",
  "Virbac Corporation": "min:10000; message:Free Shipping; else:Not Free Shipping",
  "Zoetis US LLC": "min:400; message:Free Shipping; else: $12 Shipping Fee",
};

function evalShip(rule, total) {
  if (!rule || !rule.trim()) return "Free Shipping";
  const parts = rule.split(";").map(p => p.trim());
  let result = "", meetsMin = true, matchedRange = false, fb = "Free Shipping", minVal = null;
  for (const p of parts) {
    if (p.startsWith("min:")) {
      minVal = parseFloat(p.replace("min:", ""));
      if (total < minVal) meetsMin = false;
    } else if (p.startsWith("range:")) {
      const [rp, cp] = p.replace("range:", "").split("=");
      const [mn, mx] = rp.split("-").map(x => parseFloat(x));
      if (total >= mn && total <= mx) {
        result = cp.includes("%") ? "$" + ((parseFloat(cp) * total) / 100).toFixed(2) + " Shipping Fee" : cp;
        matchedRange = true;
      }
    } else if (p.startsWith("message:")) {
      fb = p.replace("message:", "").trim();
    } else if (p.startsWith("else:")) {
      if (!meetsMin && !matchedRange && !result) result = p.replace("else:", "").trim();
    }
  }
  var status = result || (meetsMin ? fb : "Will not ship");
  if (status !== "Free Shipping" && minVal != null) {
    var minStr = "$" + minVal.toLocaleString();
    if (status === "Will not ship" || status.toLowerCase().includes("not ship")) return "Not Shipping: " + minStr + " minimum";
    if (status === "Not Free Shipping" || status.toLowerCase().includes("not free")) return "Not Free Shipping: " + minStr + " minimum";
    return status + ": " + minStr + " minimum";
  }
  return status;
}

/* ═══════ CONSTANTS ═══════ */
const EXCLUDED = ["truepill", "vetcove generics", "bloodworth"];
const VENDOR_LABELS = {
  "Boehringer Ingelheim Animal Health": "Truecommerce",
  "Ceva Animal Health": "Truecommerce",
  "Clipper Distributing Co., LLC": "Truecommerce",
  "Elanco US Inc.": "Truecommerce",
  "Zoetis US LLC": "Truecommerce",
  "ExeGi Pharma LLC": "Website Ordering",
  "Patterson Veterinary": "Website Ordering",
};
function getVendorLabel(v) { return VENDOR_LABELS[v] || null; }
const BKO_SKIP = ["Bloodworth Wholesale Drugs", "Elanco US Inc."];
const WH = {
  "TP-NY": { label: "Brooklyn", full: "Brooklyn, NY", color: "#3B82F6", emailTo: "nigel.white@fuzehealth.com, anna.wilson@fuzehealth.com, trudie.selby@fuzehealth.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Brooklyn " + d; } },
  "TP-OH": { label: "Ohio", full: "Ohio", color: "#059669", emailTo: "nigel.white@fuzehealth.com, anna.wilson@fuzehealth.com, trudie.selby@fuzehealth.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Ohio " + d; } },
  "TP-CA": { label: "Hayward", full: "Hayward, CA", color: "#D97706", emailTo: "nigel.white@fuzehealth.com, anna.wilson@fuzehealth.com, trudie.selby@fuzehealth.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Hayward " + d; } },
  "TP-FL": { label: "Miami", full: "Miami, FL", color: "#F43F5E", emailTo: "nigel.white@fuzehealth.com, anna.wilson@fuzehealth.com, trudie.selby@fuzehealth.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Miami " + d; } },
  "GGM-KY": { label: "GoGoMeds", full: "GoGoMeds, KY", color: "#8B5CF6", emailTo: "p.pocsatko@gogomeds.com, m.shull@gogomeds.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Weekly Replenishment Orders " + d; } },
  "GGM-AZ": { label: "GoGoMeds AZ", full: "GoGoMeds, AZ", color: "#EC4899", emailTo: "r.aldrich@gogomeds.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Weekly Replenishment Orders " + d; } },
};

/* ═══════ VENDOR CONTACTS ═══════ */
const CONTACTS = {
  "American Regent Animal Health": "cs@americanregent.com, BTumolo@americanregent.com",
  "Boehringer Ingelheim Animal Health": "CustomerCare@Boehringer-Ingelheim.com",
  "Ceva Animal Health": "codie.zwicky@ceva.com",
  "Clipper Distributing Co., LLC": "customerservice@clipperdist.net",
  "Creative Science": "khauf@creativesciencellc.com",
  "Comfurt Collar LLC": "brittany@comfurtcollar.com",
  "Elanco US Inc.": "KARA.HIATT@elancoah.com, ElancoCustServ@elancoah.com",
  "Merck Animal Health": "distributorsupport@merck.com, distpoultrycs@merck.com",
  "Neogen Corporation": "EPerez2@neogen.com",
  "Nextmune US LLC": "derm@nextmune.com",
  "Pet Honesty": "amanda@pethonesty.com, eliza@pethonesty.com",
  "RX Vitamins": "info@rxvitamins.com, msyku@rxvitamins.com",
  "UltiMed, Inc.": "customerservice@ultimedinc.com",
  "Vet Brands International, Inc.": "jennifer@vetbrands.com",
  "Vetoquinol USA": "customerserviceusa@vetoquinol.com, heather.larson@vetoquinol.com, johnny.soto@vetoquinol.com",
  "Vetnique": "Orders@Vetnique.com, lsteadman@vetnique.com, aidan.campbell@yumove.com",
  "Food Science LLC": "ksturtevant@foodsciencecorp.com",
  "VetriMax": "patrick@vetrimaxproducts.com",
  "Virbac Corporation": "purchaseordersonly@virbacus.com, pamela.mouser@virbacus.com, crissy.powell@virbacus.com",
  "Zoetis US LLC": "majoraccountsgroup@zoetis.com",
  "Nipro Medical Corporation": "USNiproRMA@nipromed.com",
  "ExeGi Pharma LLC": "info@visbiomevet.com",
};

/* ═══════ DEMO DATA ═══════ */
const PO_DEMO = {
  "TP-NY": [
    { SKUNDC: "10017-1990-01", Description: "Zylkene Capsules: [225mg] Bottle of 30", OrderQty: 48, VendorName: "Vetoquinol USA", OrderNbr: "PO007171", Warehouse: "TP-NY", ReorderPoint: 11, MaxQty: 36, LeadTime: 7, MinOrderQty: 12, QtyAvailable: -3, Price: 38.04, MovementClass: "" },
    { SKUNDC: "50383-0286-04", Description: "Adequan Canine Injectable: [100mg/mL] 5mL Vial", OrderQty: 24, VendorName: "American Regent Animal Health", OrderNbr: "PO007165", Warehouse: "TP-NY", ReorderPoint: 8, MaxQty: 24, LeadTime: 5, MinOrderQty: 6, QtyAvailable: 2, Price: 65.50, MovementClass: "" },
    { SKUNDC: "00061-4110-01", Description: "Heartgard Plus Chewable: [Brown 51-100lbs] 6ct", OrderQty: 36, VendorName: "Boehringer Ingelheim Animal Health", OrderNbr: "PO007168", Warehouse: "TP-NY", ReorderPoint: 15, MaxQty: 48, LeadTime: 3, MinOrderQty: 12, QtyAvailable: 5, Price: 32.99, MovementClass: "" },
    { SKUNDC: "10668-1000-01", Description: "Galliprant Tablets: [20mg] 30ct Bottle", OrderQty: 12, VendorName: "Elanco US Inc.", OrderNbr: "PO007170", Warehouse: "TP-NY", ReorderPoint: 5, MaxQty: 18, LeadTime: 4, MinOrderQty: 6, QtyAvailable: 0, Price: 78.40, MovementClass: "" },
    { SKUNDC: "54771-2320-01", Description: "Apoquel Tablets: [16mg] 100ct Bottle", OrderQty: 6, VendorName: "Zoetis US LLC", OrderNbr: "PO007172", Warehouse: "TP-NY", ReorderPoint: 3, MaxQty: 10, LeadTime: 5, MinOrderQty: 2, QtyAvailable: 1, Price: 245.00, MovementClass: "" },
    { SKUNDC: "54771-6355-01", Description: "Simparica Trio Chewable: [Gold 44.1-88lbs] 6ct", OrderQty: 12, VendorName: "Zoetis US LLC", OrderNbr: "PO007172", Warehouse: "TP-NY", ReorderPoint: 5, MaxQty: 16, LeadTime: 5, MinOrderQty: 6, QtyAvailable: 2, Price: 135.50, MovementClass: "" },
    { SKUNDC: "54771-2318-01", Description: "Apoquel Tablets: [3.6mg] 100ct Bottle", OrderQty: 4, VendorName: "Zoetis US LLC", OrderNbr: "PO007201", Warehouse: "TP-NY", ReorderPoint: 2, MaxQty: 6, LeadTime: 5, MinOrderQty: 2, QtyAvailable: 0, Price: 185.00, MovementClass: "" },
  ],
  "TP-OH": [
    { SKUNDC: "00061-4110-01", Description: "Heartgard Plus Chewable: [Brown 51-100lbs] 6ct", OrderQty: 48, VendorName: "Boehringer Ingelheim Animal Health", OrderNbr: "PO007200", Warehouse: "TP-OH", ReorderPoint: 20, MaxQty: 60, LeadTime: 3, MinOrderQty: 12, QtyAvailable: 8, Price: 32.99, MovementClass: "" },
    { SKUNDC: "54771-2320-01", Description: "Apoquel Tablets: [16mg] 100ct Bottle", OrderQty: 12, VendorName: "Zoetis US LLC", OrderNbr: "PO007201", Warehouse: "TP-OH", ReorderPoint: 5, MaxQty: 18, LeadTime: 5, MinOrderQty: 2, QtyAvailable: 0, Price: 245.00, MovementClass: "" },
    { SKUNDC: "10668-1000-01", Description: "Galliprant Tablets: [20mg] 30ct Bottle", OrderQty: 18, VendorName: "Elanco US Inc.", OrderNbr: "PO007202", Warehouse: "TP-OH", ReorderPoint: 6, MaxQty: 24, LeadTime: 4, MinOrderQty: 6, QtyAvailable: 2, Price: 78.40, MovementClass: "" },
    { SKUNDC: "86078-0110-02", Description: "Bravecto Chewable: [1000mg] 44-88lbs 1ct", OrderQty: 30, VendorName: "Merck Animal Health", OrderNbr: "PO007203", Warehouse: "TP-OH", ReorderPoint: 10, MaxQty: 36, LeadTime: 6, MinOrderQty: 10, QtyAvailable: 4, Price: 52.75, MovementClass: "" },
    { SKUNDC: "10017-1990-01", Description: "Zylkene Capsules: [225mg] Bottle of 30", OrderQty: 36, VendorName: "Vetoquinol USA", OrderNbr: "PO007204", Warehouse: "TP-OH", ReorderPoint: 8, MaxQty: 30, LeadTime: 7, MinOrderQty: 12, QtyAvailable: -2, Price: 38.04, MovementClass: "" },
  ],
  "TP-CA": [
    { SKUNDC: "54771-2320-01", Description: "Apoquel Tablets: [16mg] 100ct Bottle", OrderQty: 8, VendorName: "Zoetis US LLC", OrderNbr: "PO007210", Warehouse: "TP-CA", ReorderPoint: 4, MaxQty: 12, LeadTime: 5, MinOrderQty: 2, QtyAvailable: 1, Price: 245.00, MovementClass: "" },
    { SKUNDC: "00061-4110-01", Description: "Heartgard Plus Chewable: [Brown 51-100lbs] 6ct", OrderQty: 24, VendorName: "Boehringer Ingelheim Animal Health", OrderNbr: "PO007211", Warehouse: "TP-CA", ReorderPoint: 10, MaxQty: 36, LeadTime: 3, MinOrderQty: 12, QtyAvailable: 4, Price: 32.99, MovementClass: "" },
    { SKUNDC: "10668-1001-01", Description: "Galliprant Tablets: [60mg] 30ct Bottle", OrderQty: 6, VendorName: "Elanco US Inc.", OrderNbr: "PO007212", Warehouse: "TP-CA", ReorderPoint: 3, MaxQty: 10, LeadTime: 4, MinOrderQty: 6, QtyAvailable: 0, Price: 115.20, MovementClass: "" },
    { SKUNDC: "50383-0286-04", Description: "Adequan Canine Injectable: [100mg/mL] 5mL Vial", OrderQty: 12, VendorName: "American Regent Animal Health", OrderNbr: "PO007213", Warehouse: "TP-CA", ReorderPoint: 4, MaxQty: 12, LeadTime: 5, MinOrderQty: 6, QtyAvailable: -1, Price: 65.50, MovementClass: "sell-off item" },
  ],
  "GGM-KY": [
    { SKUNDC: "54771-2320-01", Description: "Apoquel Tablets: [16mg] 100ct Bottle", OrderQty: 10, VendorName: "Zoetis US LLC", OrderNbr: "PO007220", Warehouse: "GGM-KY", ReorderPoint: 4, MaxQty: 14, LeadTime: 5, MinOrderQty: 2, QtyAvailable: 2, Price: 245.00, MovementClass: "" },
    { SKUNDC: "00061-4110-01", Description: "Heartgard Plus Chewable: [Brown 51-100lbs] 6ct", OrderQty: 18, VendorName: "Boehringer Ingelheim Animal Health", OrderNbr: "PO007221", Warehouse: "GGM-KY", ReorderPoint: 8, MaxQty: 24, LeadTime: 3, MinOrderQty: 6, QtyAvailable: 3, Price: 32.99, MovementClass: "" },
    { SKUNDC: "86078-0110-02", Description: "Bravecto Chewable: [1000mg] 44-88lbs 1ct", OrderQty: 20, VendorName: "Merck Animal Health", OrderNbr: "PO007222", Warehouse: "GGM-KY", ReorderPoint: 8, MaxQty: 24, LeadTime: 6, MinOrderQty: 10, QtyAvailable: 5, Price: 52.75, MovementClass: "" },
  ],
  "GGM-AZ": [
    { SKUNDC: "54771-2320-01", Description: "Apoquel Tablets: [16mg] 100ct Bottle", OrderQty: 6, VendorName: "Zoetis US LLC", OrderNbr: "PO007230", Warehouse: "GGM-AZ", ReorderPoint: 3, MaxQty: 10, LeadTime: 5, MinOrderQty: 2, QtyAvailable: 1, Price: 245.00, MovementClass: "" },
    { SKUNDC: "00061-4110-01", Description: "Heartgard Plus Chewable: [Brown 51-100lbs] 6ct", OrderQty: 12, VendorName: "Boehringer Ingelheim Animal Health", OrderNbr: "PO007231", Warehouse: "GGM-AZ", ReorderPoint: 5, MaxQty: 16, LeadTime: 3, MinOrderQty: 6, QtyAvailable: 2, Price: 32.99, MovementClass: "" },
  ],
};

const SD_DEMO = [
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "Healthy Gut & Digestion Capsule: Bottle of 120", VendorName: "Food Science LLC", InventoryID: "900374.12", SKUNDC: "26664-0137-41", BestKnownDating: "7/31/2026", NoteText: "", QtyOnHand: 0, BaseUnit: "BOTTLE", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "GastroGard Oral Paste for Horses: [6.15g] 72pk", VendorName: "Boehringer Ingelheim Animal Health", InventoryID: "126631", SKUNDC: "00010-3704-02", BestKnownDating: "7/31/2026", NoteText: "going to order this item", QtyOnHand: 72, BaseUnit: "SYRING", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "Marquis Oral Paste for Horses: [127g] Syringe", VendorName: "Boehringer Ingelheim Animal Health", InventoryID: "126672", SKUNDC: "00010-7314-02", BestKnownDating: "9/30/2026", NoteText: "", QtyOnHand: 21, BaseUnit: "SYRING", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "Previcox Chewable Tablets: [57mg] 60ct", VendorName: "Boehringer Ingelheim Animal Health", InventoryID: "126898", SKUNDC: "00010-9150-03", BestKnownDating: "9/30/2026", NoteText: "", QtyOnHand: 60, BaseUnit: "TABLET", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "Interceptor Plus Chewable: [Blue 2-8lbs] 6ct", VendorName: "Elanco US Inc.", InventoryID: "127049", SKUNDC: "58198-7648-01", BestKnownDating: "11/30/2026", NoteText: "", QtyOnHand: 18, BaseUnit: "PKG", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "Bravecto Chewable: [1000mg] 44-88lbs 1ct", VendorName: "Merck Animal Health", InventoryID: "127003", SKUNDC: "86078-0110-02", BestKnownDating: "2/28/2027", NoteText: "", QtyOnHand: 60, BaseUnit: "TABLET", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "Pet Honesty Allergy Support Chew: Duck [90ct]", VendorName: "Pet Honesty", InventoryID: "900288", SKUNDC: "85270-9008-03", BestKnownDating: "11/30/2026", NoteText: "", QtyOnHand: 7, BaseUnit: "PKG", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "VetriScience Composure Calming Chews Cats: [30ct]", VendorName: "Vet Brands International, Inc.", InventoryID: "900093", SKUNDC: "20726-0021-05", BestKnownDating: "1/31/2027", NoteText: "", QtyOnHand: 12, BaseUnit: "PKG", OpenQty: 0 },
  { ItemStatus: "Active", MovementClass: "Short-Dating", Description: "Vet-Kem Siphotrol Plus II Spray: [16oz]", VendorName: "Clipper Distributing Co., LLC", InventoryID: "126963", SKUNDC: "93486-0002-16", BestKnownDating: "6/30/2027", NoteText: "", QtyOnHand: 3, BaseUnit: "CAN", OpenQty: 0 },
];

const BKO_DEMO = [
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Metacam Oral Suspension: [0.5mg/mL] 15mL", VendorName: "Boehringer Ingelheim Animal Health", InventoryID: "138776", SKUNDC: "00010-6014-01", BaseUnit: "BOTTLE", QtyOnHand: 0, OpenQty: 57, RecoveryDate: "Mid March" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Metacam Oral Suspension: [1.5mg/mL] 100mL", VendorName: "Boehringer Ingelheim Animal Health", InventoryID: "140354", SKUNDC: "00010-6015-03", BaseUnit: "BOTTLE", QtyOnHand: 0, OpenQty: 0, RecoveryDate: "late February" },
  { ItemStatus: "Active", MovementClass: "Long-Term Backorder", Description: "Equidone Gel for Horses: [25mL] Syringe", VendorName: "Clipper Distributing Co., LLC", InventoryID: "EQU-025S", SKUNDC: "17033-0326-01", BaseUnit: "SYRING", QtyOnHand: 0, OpenQty: 0, RecoveryDate: "no eta" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Vetradent Toothpaste: [2.3oz] Tube", VendorName: "Clipper Distributing Co., LLC", InventoryID: "533-65", SKUNDC: "10007-6710-99", BaseUnit: "TUBE", QtyOnHand: 0, OpenQty: 12, RecoveryDate: "2/16/2026" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Advantage II for Dogs: [Purple XL 55+lbs] 6pk", VendorName: "Elanco US Inc.", InventoryID: "86336669", SKUNDC: "24089-0203-21", BaseUnit: "PACK", QtyOnHand: 0, OpenQty: 0, RecoveryDate: "late Feb" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Advantage Multi for Cats: [Turquoise 2-5lbs] 3pk", VendorName: "Elanco US Inc.", InventoryID: "90209680", SKUNDC: "00859-2344-01", BaseUnit: "TUBE", QtyOnHand: 0, OpenQty: 12, RecoveryDate: "Week of 3/2" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "VetriScience Canine Plus Senior Multivitamin: [30ct]", VendorName: "Vet Brands International, Inc.", InventoryID: "900084", SKUNDC: "20726-0000-03", BaseUnit: "PKG", QtyOnHand: 0, OpenQty: 0, RecoveryDate: "March" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "VetriScience Composure Pro Calming Chews: [60ct]", VendorName: "Vet Brands International, Inc.", InventoryID: "900092", SKUNDC: "20726-0021-04", BaseUnit: "PKG", QtyOnHand: 0, OpenQty: 12, RecoveryDate: "Mid March" },
  { ItemStatus: "Active", MovementClass: "Long-Term Backorder", Description: "Healthy Gut & Digestion Capsule: Bottle of 60", VendorName: "Food Science LLC", InventoryID: "900374.6", SKUNDC: "26664-0137-31", BaseUnit: "BOTTLE", QtyOnHand: 0, OpenQty: 0, RecoveryDate: "no eta" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Apoquel Tablets: [3.6mg] 100ct Bottle", VendorName: "Zoetis US LLC", InventoryID: "127035", SKUNDC: "54771-2318-01", BaseUnit: "TABLET", QtyOnHand: 0, OpenQty: 18, RecoveryDate: "Mid March" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Revolution Plus Topical Cats: [Gold 11.1-22lbs] 6ct", VendorName: "Zoetis US LLC", InventoryID: "127098", SKUNDC: "10086-0627-06", BaseUnit: "PKG", QtyOnHand: 0, OpenQty: 24, RecoveryDate: "Week of 3/9" },
  { ItemStatus: "Active", MovementClass: "Manufacturer Backorder", Description: "Knockout Area Treatment Spray: [16oz]", VendorName: "Virbac Corporation", InventoryID: "126967", SKUNDC: "10043-0917-16", BaseUnit: "CAN", QtyOnHand: 12, OpenQty: 0, RecoveryDate: "March" },
];

/* ═══════ ICONS ═══════ */
function IconWH() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21V12h6v9"/></svg>; }
function IconTruck() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>; }
function IconMail() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>; }
function IconAlert() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function IconCheck() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IconDL() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
function IconFilter() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>; }
function IconKey() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>; }
function IconRefresh() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>; }
function IconLock() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconGmail() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>; }
function IconBox() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IconUpload() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>; }
function IconCSV() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>; }
function Dot({ color }) { return <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />; }
function Spinner({ color, size }) { return <span style={{ width: size || 14, height: size || 14, border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid " + (color || "#fff"), borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />; }

function InfoTip({ text }) {
  var _show = useState(false), show = _show[0], setShow = _show[1];
  return <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={function() { setShow(true); }} onMouseLeave={function() { setShow(false); }}>
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: "1.5px solid #9CA3AF", color: "#9CA3AF", fontSize: 11, fontWeight: 700, cursor: "help", flexShrink: 0, lineHeight: 1 }}>i</span>
    {show && <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "#1F2937", color: "#fff", fontSize: 12, lineHeight: 1.4, padding: "8px 12px", borderRadius: 8, whiteSpace: "normal", width: 240, zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", pointerEvents: "none" }}>{text}<span style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "6px solid #1F2937" }} /></span>}
  </span>;
}

/* ═══════ CACHE STATUS HELPERS ═══════ */
function formatRelativeTime(ms) {
  if (!ms) return null;
  var sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return sec + "s ago";
  var min = Math.floor(sec / 60);
  if (min < 60) return min + " min ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var day = Math.floor(hr / 24);
  return day + "d ago";
}
function CacheStatus(props) {
  var lastFetchedAt = props.lastFetchedAt, cacheHit = props.cacheHit, onRefresh = props.onRefresh, refreshing = props.refreshing, color = props.color || "#6B7280";
  var _tick = useState(0), tick = _tick[0], setTick = _tick[1];
  useEffect(function() { var id = setInterval(function() { setTick(function(t) { return t + 1; }); }, 30000); return function() { clearInterval(id); }; }, []);
  if (!lastFetchedAt && !refreshing) return null;
  var label = refreshing ? "Refreshing\u2026" : (cacheHit === true ? "Cached " : "Updated ") + (formatRelativeTime(lastFetchedAt) || "");
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9CA3AF" }} title={lastFetchedAt ? new Date(lastFetchedAt).toLocaleString() : ""}>
    <span>{label}</span>
    {onRefresh && <button onClick={onRefresh} disabled={refreshing} title="Force fresh data" style={{ background: "transparent", border: "0.5px solid #E5E7EB", borderRadius: 6, padding: "2px 8px", cursor: refreshing ? "not-allowed" : "pointer", fontSize: 11, color: color, fontFamily: "'Varela Round', sans-serif", display: "inline-flex", alignItems: "center", gap: 4 }}>{refreshing ? "\u21BB" : "\u21BB Refresh"}</button>}
  </span>;
}

/* ═══════ STYLES ═══════ */
function makeStyles(accent) {
  return {
    card: { background: "#FFFFFF", border: "0.5px solid #E5E7EB", borderRadius: 14, padding: 24, marginBottom: 20 },
    statCard: { borderRadius: 14, padding: "20px 24px", flex: 1, minWidth: 160, position: "relative", overflow: "hidden" },
    btn: function(v) {
      var base = { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" };
      if (v === "danger") return Object.assign({}, base, { background: "#DC2626", color: "#fff" });
      if (v === "ghost") return Object.assign({}, base, { background: "transparent", color: "#6B7280", border: "1px solid #E5E7EB" });
      return Object.assign({}, base, { background: accent, color: "#fff" });
    },
    inp: { background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "9px 14px", color: "#1F2937", fontSize: 13, outline: "none", width: "100%" },
    sel: { background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "9px 14px", color: "#1F2937", fontSize: 13, outline: "none" },
    th: { padding: "10px 16px", textAlign: "left", background: "#F9FAFB", color: "#9CA3AF", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid #E5E7EB", position: "sticky", top: 0, zIndex: 2 },
    td: { padding: "14px 16px", borderBottom: "1px solid #F3F4F6", color: "#374151", fontSize: 13 },
    badge: function(t) {
      var base = { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500 };
      var colors = { success: ["#ECFDF5", "#059669"], danger: ["#FEF2F2", "#DC2626"], warning: ["#FFFBEB", "#D97706"], purple: ["#F5F3FF", "#7C3AED"], blue: ["#EFF6FF", "#2563EB"] };
      var c = colors[t] || ["#F3F4F6", "#6B7280"];
      return Object.assign({}, base, { background: c[0], color: c[1] });
    },
    pill: function(active, col) {
      return { padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6, background: active ? (col || accent) : "transparent", color: active ? "#fff" : "#9CA3AF" };
    },
  };
}

function Gate({ ok, prompt, children, style, onClick, disabled }) {
  if (ok) return <button style={style} onClick={onClick} disabled={disabled}>{children}</button>;
  return <button style={Object.assign({}, style, { opacity: 0.6 })} onClick={prompt}><IconLock /> Login Required</button>;
}

function CopyCell({ text, toast, color, accentColor }) {
  var _copied = useState(false), copied = _copied[0], setCopied = _copied[1];
  return (
    <div title={"Click to copy: " + text} onClick={function() { navigator.clipboard.writeText(text); setCopied(true); toast("Copied: " + text.slice(0, 40)); setTimeout(function() { setCopied(false); }, 1500); }}
      style={{ cursor: "pointer", padding: "6px 10px", borderRadius: 8, wordBreak: "break-word", lineHeight: 1.4, color: color || "#374151", display: "flex", alignItems: "flex-start", gap: 6, background: copied ? "#ECFDF5" : "#F9FAFB", border: "1px solid " + (copied ? "#059669" : "#E5E7EB"), transition: "all 0.2s" }}>
      <span style={{ flex: 1, fontSize: 12 }}>{text}</span>
      <span style={{ flexShrink: 0, marginTop: 2, color: copied ? "#059669" : "#B5AEA5", transition: "all 0.2s" }}>{copied ? <IconCheck /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>}</span>
    </div>
  );
}

/* ═══════ TRACKER TOOL (Short-Dating + Backorder) ═══════ */
function TrackerTool(props) {
  var toolKey = props.toolKey, toolLabel = props.toolLabel, toolColor = props.toolColor;
  var demoData = props.demoData, columns = props.columns, emailConfig = props.emailConfig;
  var skipVendors = props.skipVendors || [];
  var toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred, gmail = props.gmail;
  var contacts = props.contacts || CONTACTS;

  var _sp = useState("data"), subPage = _sp[0], setSubPage = _sp[1];
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _q = useState(""), search = _q[0], setSearch = _q[1];
  var _vf = useState("all"), vendorFilter = _vf[0], setVendorFilter = _vf[1];
  var _il = useState(true), initLoading = _il[0], setInitLoading = _il[1];
  var _rb = useState(null), runBy = _rb[0], setRunBy = _rb[1];
  var _rt = useState(null), runTime = _rt[0], setRunTime = _rt[1];
  var _dr = useState(0), drafts = _dr[0], setDrafts = _dr[1];
  var _cc = useState(false), confirmClear = _cc[0], setConfirmClear = _cc[1];

  var S = useMemo(function() { return makeStyles(toolColor); }, [toolColor]);
  var storageKey = "tracker-" + toolKey;
  var kvTrackerKey = "tracker-shared-" + toolKey;

  useEffect(function() {
    var mounted = true;
    (async function() {
      // Try KV first (shared with team)
      try {
        var resp = await kvGet(kvTrackerKey);
        var json = await resp.json();
        if (mounted && json.data && json.data.data && json.data.data.length > 0) {
          var shared = json.data;
          setData(shared.data); setRunBy(shared.runBy || null); setRunTime(shared.runTime || null); setDrafts(shared.drafts || 0);
          sSet(storageKey, shared);
          // Auto-fetch if stale (older than today)
          if (cred && cred.username && cred.password && shared.fetchedAt) {
            var today = new Date().toISOString().slice(0, 10);
            var fetchedDay = new Date(shared.fetchedAt).toISOString().slice(0, 10);
            if (fetchedDay < today) {
              // Stale - auto-refresh in background
              try {
                var rows = await fetchAcumatica(toolKey, null, cred.username, cred.password);
                var now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                if (mounted) { setData(rows); setRunBy("Auto"); setRunTime(now); setDrafts(0); }
                var payload = { data: rows, runBy: "Auto", runTime: now, drafts: 0, fetchedAt: Date.now() };
                sSet(storageKey, payload); kvPost(kvTrackerKey, payload);
              } catch (e) { /* keep stale data */ }
            }
          }
          if (mounted) setInitLoading(false);
          return;
        }
      } catch (e) { /* fall through to localStorage */ }
      // Fallback to localStorage
      var saved = sGet(storageKey);
      if (mounted && saved && saved.data && saved.data.length > 0) {
        setData(saved.data); setRunBy(saved.runBy || null); setRunTime(saved.runTime || null); setDrafts(saved.drafts || 0);
      }
      if (mounted) setInitLoading(false);
    })();
    return function() { mounted = false; };
  }, [storageKey]);

  var persist = useCallback(async function(d, by, time, dr) {
    var payload = { data: d, runBy: by, runTime: time, drafts: dr, fetchedAt: Date.now() };
    sSet(storageKey, payload);
    kvPost(kvTrackerKey, payload).catch(function() {});
  }, [storageKey, kvTrackerKey]);

  var syncData = useCallback(async function() {
    setLoading(true);
    try {
      var rows;
      if (cred && cred.username && cred.password) {
        rows = await fetchAcumatica(toolKey, null, cred.username, cred.password);
      } else {
        // Fallback to demo data when no credentials (dev mode)
        rows = demoData.filter(function(r) { return r.SKUNDC && (r.ItemStatus || "").toLowerCase() !== "inactive"; });
      }
      var now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      setData(rows); setRunBy("You"); setRunTime(now); setDrafts(0);
      persist(rows, "You", now, 0);
      toast(toolLabel + ": Synced " + rows.length + " items");
    } catch (err) {
      toast("Error: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [cred, toast, persist, demoData, toolLabel, toolKey]);

  var clearAll = useCallback(async function() {
    setData([]); setRunBy(null); setRunTime(null); setDrafts(0); setConfirmClear(false); setSubPage("data");
    sDel(storageKey);
    kvPost(kvTrackerKey, {}).catch(function() {});
    toast(toolLabel + ": Cleared");
  }, [toast, storageKey, kvTrackerKey, toolLabel]);

  var vendorGroups = useMemo(function() {
    var g = {};
    data.forEach(function(r) { var v = r.VendorName || "Unknown"; if (!g[v]) g[v] = []; g[v].push(r); });
    return g;
  }, [data]);

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

  var emailVendors = useMemo(function() {
    return Object.entries(vendorGroups).filter(function(e) { return skipVendors.indexOf(e[0]) < 0; }).sort(function(a, b) { return a[0].localeCompare(b[0]); });
  }, [vendorGroups, skipVendors]);

  var genDrafts = useCallback(async function() {
    if (!ok) { lp(); return; }
    if (!gmail || !gmail.token) { toast("Please connect your Gmail account first (bottom-left)", "error"); return; }
    try {
      var draftPayloads = emailVendors.map(function(entry) {
        var vendor = entry[0], items = entry[1];
        var vendorEmail = contacts[vendor] || "";
        var toLine = emailConfig.buildTo(vendorEmail);
        if (!toLine) return null;
        var tableRows = items.map(function(r, i) {
          return "<tr>" + emailConfig.tableCols.map(function(c) {
            return "<td style=\"padding:6px;border:1px solid #ddd;\">" + (c.key === "#" ? (i+1) : String(r[c.key] != null ? r[c.key] : "")) + "</td>";
          }).join("") + "</tr>";
        }).join("");
        var tableHead = "<tr style=\"background:#e6e6fa;font-weight:bold;\">" + emailConfig.tableCols.map(function(c) {
          return "<th style=\"padding:6px;border:1px solid #ddd;\">" + c.label + "</th>";
        }).join("") + "</tr>";
        var htmlBody = emailConfig.buildHtmlBody ? emailConfig.buildHtmlBody(items) :
          "<p>Hi,</p><p>Could you please provide an update on the items listed below?</p>" +
          "<table border=\"1\" cellpadding=\"6\" cellspacing=\"0\" style=\"border-collapse:collapse;\">" +
          "<thead>" + tableHead + "</thead><tbody>" + tableRows + "</tbody></table>" +
          "<p>Thank you!</p>";
        return { to: toLine, cc: "hd-purchaseorders@vetcove.com", subject: emailConfig.subjectPrefix + new Date().toLocaleDateString("en-US"), htmlBody: htmlBody };
      }).filter(Boolean);
      var result = await postGmailDrafts(draftPayloads, gmail.token);
      if (result.failed > 0) {
        toast(toolLabel + ": " + result.created + " created, " + result.failed + " failed", "error");
      } else {
        toast(toolLabel + ": " + result.created + " email drafts created in Gmail");
      }
      var count = result.created || 0;
      setDrafts(count);
      persist(data, runBy, runTime, count);
    } catch (err) {
      toast("Gmail error: " + err.message, "error");
    }
  }, [ok, lp, gmail, emailVendors, emailConfig, toast, data, runBy, runTime, persist, toolLabel, contacts]);

  if (initLoading) return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#6B7280" })}><Spinner color={toolColor} size={20} /></div>;

  var ToolIcon = toolKey === "backorder" ? IconBox : IconClock;
  var dataLabel = toolKey === "backorder" ? "Backorder Data" : "Short Data";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "#F8F9FB", borderRadius: 10, padding: 3 }}>
          <button onClick={function() { setSubPage("data"); }} style={S.pill(subPage === "data", toolColor)}>{dataLabel}{data.length > 0 && <span style={{ fontSize: 10, background: subPage === "data" ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4 }}>{data.length}</span>}</button>
          <button onClick={function() { if (!ok) { lp(); return; } setSubPage("emails"); }} style={Object.assign({}, S.pill(subPage === "emails", toolColor), !ok ? { opacity: 0.5 } : {})}>{!ok && <IconLock />} Email Drafts</button>
          <button onClick={function() { if (!ok) { lp(); return; } setSubPage("contacts"); }} style={Object.assign({}, S.pill(subPage === "contacts", toolColor), !ok ? { opacity: 0.5 } : {})}>{!ok && <IconLock />} Vendor Contacts</button>
        </div>
        <div style={{ flex: 1 }} />
        {runTime && <span style={{ fontSize: 11, color: "#9CA3AF" }}>Last: {runTime}{runBy ? " by " + runBy : ""}</span>}
        {data.length > 0 && <span style={S.badge(drafts > 0 ? "success" : "default")}>{drafts > 0 ? <><IconCheck /> {drafts} drafts</> : data.length + " items"}</span>}
        {data.length > 0 && (confirmClear
          ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: "#DC2626" }}>Clear?</span><button onClick={clearAll} style={Object.assign({}, S.btn("danger"), { padding: "6px 14px", fontSize: 12 })}>Yes</button><button onClick={function() { setConfirmClear(false); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>No</button></div>
          : <button onClick={function() { setConfirmClear(true); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12, color: "#6B7280" })}><IconTrash /> Clear</button>
        )}
      </div>

      {subPage === "data" && <div>
        <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 16, padding: "16px 24px" })}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: toolColor + "20", display: "flex", alignItems: "center", justifyContent: "center", color: toolColor }}><ToolIcon /></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#1F2937" }}>{toolLabel}</div><div style={{ fontSize: 12, color: "#6B7280" }}>{data.length > 0 ? data.length + " items across " + uniqueVendors.length + " vendors" : "No data synced"}</div></div>
          <button style={Object.assign({}, S.btn(), { padding: "10px 24px" })} onClick={syncData} disabled={loading}>{loading ? <><Spinner /> Syncing...</> : <><IconRefresh /> {data.length > 0 ? "Re-sync" : "Sync Data"}</>}</button>
        </div>
        {data.length > 0 && <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
            <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
            <div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: "#6B7280" }}>{filtered.length}/{data.length}</span>
          </div>
          <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
              <thead><tr>{columns.map(function(c) { return <th key={c.key} style={Object.assign({}, S.th, c.align === "right" ? { textAlign: "right" } : {})}>{c.label}</th>; })}</tr></thead>
              <tbody>{filtered.map(function(row, idx) {
                var mc = (row.MovementClass || "").toLowerCase();
                var isLT = mc.indexOf("long-term") >= 0;
                return <tr key={idx} style={{ background: isLT ? "rgba(239,68,68,0.04)" : "transparent" }}>{columns.map(function(col) {
                  var val = row[col.key] != null ? row[col.key] : "";
                  var vs = String(val);
                  if (col.copyable) return <td key={col.key} style={Object.assign({}, S.td, { maxWidth: 280 })}><CopyCell text={vs} toast={toast} accentColor={toolColor} /></td>;
                  if (col.badgeFn) return <td key={col.key} style={S.td}><span style={S.badge(col.badgeFn(vs))}>{vs}</span></td>;
                  return <td key={col.key} style={Object.assign({}, S.td, col.align === "right" ? { textAlign: "right" } : {}, col.highlightColor ? { color: col.highlightColor } : {})}>{vs}</td>;
                })}</tr>;
              })}</tbody>
            </table>
          </div>
        </>}
        {data.length === 0 && !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}><ToolIcon /><p style={{ marginTop: 12, fontSize: 14 }}>Click <strong>Sync Data</strong> to pull {toolLabel.toLowerCase()} from Acumatica.</p></div>}
      </div>}

      {subPage === "emails" && <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1F2937", margin: "0 0 4px" }}>{emailConfig.title}</h3>
        <p style={{ color: "#6B7280", fontSize: 12, margin: "0 0 16px" }}>{emailConfig.subtitle}</p>
        {skipVendors.length > 0 && <div style={{ background: "rgba(100,116,139,0.06)", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#6B7280" }}>Skipped: {skipVendors.join(", ")}</div>}
        {drafts > 0 && <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconCheck /><span style={{ fontSize: 13, color: "#059669" }}><strong>{drafts} draft(s) created!</strong></span></div>}
        {data.length > 0 ? <>
          {emailVendors.map(function(entry) {
            var vendor = entry[0], items = entry[1];
            var email = contacts[vendor] || "";
            var toLine = emailConfig.buildTo(email);
            return <div key={vendor} style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>{vendor}</div><div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{items.length} items &middot; To: {toLine || "No email on file"}</div></div>
                <span style={S.badge("purple")}>{items.length}</span>
              </div>
              <div style={{ overflow: "auto", maxHeight: 200 }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 11 }}>
                  <thead><tr>{emailConfig.tableCols.map(function(c) { return <th key={c.key} style={Object.assign({}, S.th, { fontSize: 10 })}>{c.label}</th>; })}</tr></thead>
                  <tbody>{items.map(function(r, i) { return <tr key={i}>{emailConfig.tableCols.map(function(c) { return <td key={c.key} style={Object.assign({}, S.td, c.highlightColor ? { color: c.highlightColor, fontWeight: 600 } : {}, { maxWidth: 240, wordBreak: "break-word" })}>{c.key === "#" ? i + 1 : String(r[c.key] != null ? r[c.key] : "")}</td>; })}</tr>; })}</tbody>
                </table>
              </div>
            </div>;
          })}
          <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 24px", opacity: drafts > 0 ? 0.5 : 1 })} onClick={genDrafts} disabled={drafts > 0}><IconMail /> {drafts > 0 ? drafts + " Drafts Created" : "Generate " + emailVendors.length + " Email Drafts"}</Gate>
        </> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#9CA3AF" })}>Sync data first.</div>}
      </div>}

      {subPage === "contacts" && <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1F2937", margin: "0 0 16px" }}>Vendor Contacts</h3>
        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
            <thead><tr><th style={S.th}>Vendor</th><th style={S.th}>Email(s)</th></tr></thead>
            <tbody>{Object.entries(contacts).filter(function(e) { return e[1]; }).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) { return <tr key={e[0]}><td style={Object.assign({}, S.td, { fontWeight: 500, color: "#374151" })}>{e[0]}</td><td style={Object.assign({}, S.td, { fontSize: 14, color: "#6B7280" })}>{e[1]}</td></tr>; })}</tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

/* ═══════ PO WAREHOUSE TOOL ═══════ */
function WHT(props) {
  var whKey = props.whKey, cfg = props.cfg, toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred, gmail = props.gmail, SHIP_RULES = props.shipRules || {};
  var vendorChannels = props.vendorChannels || {};
  var updateVendorChannels = props.updateVendorChannels;
  var vendorContacts = props.vendorContacts || {};
  var isGGM = whKey.indexOf("GGM") === 0;
  var _sp = useState("overview"), subPage = _sp[0], setSubPage = _sp[1];
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _q = useState(""), search = _q[0], setSearch = _q[1];
  var _vf = useState("all"), vendorFilter = _vf[0], setVendorFilter = _vf[1];
  var _fo = useState(false), flagsOnly = _fo[0], setFlagsOnly = _fo[1];
  var _cc = useState(false), confirmClear = _cc[0], setConfirmClear = _cc[1];
  var _es = useState(false), emailSent = _es[0], setEmailSent = _es[1];
  var _el = useState(false), emailLoading = _el[0], setEmailLoading = _el[1];
  var _sn = useState({}), shipNotes = _sn[0], setShipNotes = _sn[1];
  var _rb = useState(null), runBy = _rb[0], setRunBy = _rb[1];
  var _rt = useState(null), runTime = _rt[0], setRunTime = _rt[1];
  var _pck = useState(null), priceCheckKey = _pck[0], setPriceCheckKey = _pck[1];
  var _pcc = useState({}), priceChecked = _pcc[0], setPriceChecked = _pcc[1];
  var _dismissed = useState({}), dismissed = _dismissed[0], setDismissed = _dismissed[1];
  var _poSort = useState({ col: null, dir: "asc" }), poSort = _poSort[0], setPoSort = _poSort[1];
  var _shipSort = useState({ col: null, dir: "asc" }), shipSort = _shipSort[0], setShipSort = _shipSort[1];
  var _pcr = useState({}), pcReported = _pcr[0], setPcReported = _pcr[1];
  var _pcs = useState(null), pcSort = _pcs[0], setPcSort = _pcs[1];
  var _esel = useState(null), emailSelected = _esel[0], setEmailSelected = _esel[1];
  var _il = useState(true), initLoading = _il[0], setInitLoading = _il[1];
  var _emailTo = useState(cfg.emailTo), emailTo = _emailTo[0], setEmailTo = _emailTo[1];
  var _emailSubject = useState(""), emailSubject = _emailSubject[0], setEmailSubject = _emailSubject[1];
  var DEFAULT_BODY = "Good morning,\n\nAttached are today's POs.\n\nThanks in advance,";
  var _emailBody = useState(DEFAULT_BODY), emailBody = _emailBody[0], setEmailBody = _emailBody[1];
  var EMAIL_OVERRIDE_KEY = "po-email-overrides:" + whKey;
  var _editingField = useState(null), editingField = _editingField[0], setEditingField = _editingField[1];
  useEffect(function() {
    var m = true;
    kvGet(EMAIL_OVERRIDE_KEY).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m || !d || !d.data) return;
      var ov = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
      if (ov.to != null) setEmailTo(ov.to);
      if (ov.subject != null) setEmailSubject(ov.subject);
      if (ov.body != null) setEmailBody(ov.body);
    }).catch(function() {});
    return function() { m = false; };
  }, [whKey]);
  function persistEmailOverride(patch) {
    var current = { to: emailTo, subject: emailSubject, body: emailBody };
    var merged = Object.assign({}, current, patch);
    kvPost(EMAIL_OVERRIDE_KEY, merged).catch(function() {});
  }
  var S = useMemo(function() { return makeStyles(cfg.color); }, [cfg.color]);
  var kvKey = "po:" + whKey;

  // Load from KV on mount, fall back to localStorage
  useEffect(function() {
    var m = true;
    (async function() {
      var loaded = false;
      // Try KV first
      try {
        var resp = await kvGet(kvKey);
        var json = await resp.json();
        if (m && json.data && json.data.data && json.data.data.length > 0) {
          setData(json.data.data); setEmailSent(json.data.emailSent || false); setRunBy(json.data.runBy || null); setRunTime(json.data.runTime || null); setSubPage("data");
          // Load shipNotes: prefer separate storage, fall back to KV bundled notes
          var savedNotes = sGet("ship-notes-" + whKey);
          setShipNotes(savedNotes || json.data.shipNotes || {});
          if (m) setKvStatus("loaded-kv:" + json.data.data.length);
          loaded = true;
        } else {
          // Show what KV returned for debugging
          var dbg = json.data === null ? "null" : json.data === undefined ? "undef" : typeof json.data === "object" ? (json.data.data ? "data:" + (json.data.data.length || 0) : "no-data-key") : typeof json.data;
          if (m) setKvStatus("kv-empty(" + dbg + ")");
        }
      } catch (e) { if (m) setKvStatus("kv-error:" + e.message); }
      // Fall back to localStorage if KV had nothing
      if (!loaded && m) {
        var s = sGet("wh-data-" + whKey);
        if (s && s.data && s.data.length > 0) {
          setData(s.data); setEmailSent(s.emailSent || false); setRunBy(s.runBy || null); setRunTime(s.runTime || null); setSubPage("data");
          var savedNotes = sGet("ship-notes-" + whKey);
          setShipNotes(savedNotes || s.shipNotes || {});
          if (m) setKvStatus("loaded-ls:" + s.data.length);
        } else {
          if (m) setKvStatus("no-data");
        }
      }
      if (m) setInitLoading(false);
    })();
    return function() { m = false; };
  }, [kvKey]);

  // Poll KV every 8 seconds for changes from other users
  useEffect(function() {
    var m = true;
    var poll = setInterval(async function() {
      try {
        var resp = await kvGet(kvKey);
        var json = await resp.json();
        if (!m || !json.data) return;
        var remote = json.data;
        // Only update if remote is newer (different runTime)
        if (remote.runTime && remote.runTime !== runTime) {
          setData(remote.data || []); setEmailSent(remote.emailSent || false); setRunBy(remote.runBy || null); setRunTime(remote.runTime || null); setShipNotes(remote.shipNotes || {});
        } else if (remote.shipNotes && JSON.stringify(remote.shipNotes) !== JSON.stringify(shipNotes)) {
          setShipNotes(remote.shipNotes);
        } else if (remote.emailSent !== emailSent) {
          setEmailSent(remote.emailSent || false);
        }
      } catch (e) {}
    }, 8000);
    return function() { m = false; clearInterval(poll); };
  }, [kvKey, runTime, shipNotes, emailSent]);

  var _kvSt = useState(""), kvStatus = _kvSt[0], setKvStatus = _kvSt[1];

  var persist = useCallback(async function(d, es, by, time, sn) {
    var payload = { data: d, emailSent: es, runBy: by, runTime: time, shipNotes: sn || {} };
    // Save shipNotes separately so they survive re-fetch
    sSet("ship-notes-" + whKey, sn || {});
    // Save to localStorage as cache
    sSet("wh-data-" + whKey, payload);
    // Save to KV for sharing with other users
    try {
      var sizeKB = Math.round(JSON.stringify(payload).length / 1024);
      var resp = await kvPost(kvKey, payload);
      var json = await resp.json();
      if (!resp.ok || json.error) { setKvStatus("save-fail:" + sizeKB + "KB " + (json.error || resp.status)); return; }
      // Verify: read it back immediately
      var vResp = await kvGet(kvKey);
      var vJson = await vResp.json();
      if (vJson.data && vJson.data.data && vJson.data.data.length > 0) {
        setKvStatus("verified:" + sizeKB + "KB," + vJson.data.data.length + "rows");
      } else {
        setKvStatus("save-lost:" + sizeKB + "KB,readback-empty");
      }
    } catch (e) { setKvStatus("save-error:" + e.message); }
  }, [kvKey, whKey]);
  var fetchData = useCallback(function() {
    if (!ok) { lp(); return; } setLoading(true); setEmailSent(false); setConfirmClear(false);
    (async function() {
      try {
        var raw;
        if (cred && cred.username && cred.password) {
          raw = await fetchAcumatica(isGGM ? "po-ggm" : "po", whKey, cred.username, cred.password);
        } else {
          raw = PO_DEMO[whKey] || [];
        }
        var excluded = isGGM ? EXCLUDED.filter(function(ex) { return ex !== "vetcove generics"; }) : EXCLUDED;
        var rows = raw.filter(function(r) { return r.SKUNDC && (r.Warehouse || "").trim() === whKey && !excluded.some(function(ex) { return (r.VendorName || "").toLowerCase().indexOf(ex) >= 0; }); }).map(function(r) { return Object.assign({}, r, { Price: Number(r.Price) || 0, OrderQty: Number(r.OrderQty) || 0, TotalPrice: +((Number(r.Price) || 0) * (Number(r.OrderQty) || 0)).toFixed(2) }); });

        // Fetch default prices from cross reference for items with $0 price
        var zeroRows = rows.filter(function(r) { return !r.Price || r.Price === 0; });
        if (zeroRows.length > 0 && cred && cred.username && cred.password) {
          try {
            var xref = await fetchAcumatica("item-xref", null, cred.username, cred.password);
            var priceMap = {};
            xref.forEach(function(x) {
              var id = String(x.InventoryID || "").trim();
              var price = parseFloat(x.DefaultPrice);
              if (id && !isNaN(price) && price > 0) priceMap[id] = price;
            });
            rows = rows.map(function(r) {
              if ((!r.Price || r.Price === 0) && priceMap[r.SKUNDC]) {
                var p = priceMap[r.SKUNDC];
                return Object.assign({}, r, { Price: p, TotalPrice: +(p * (r.OrderQty || 0)).toFixed(2) });
              }
              return r;
            });
          } catch (xrefErr) {
            console.warn("Cross reference fetch failed:", xrefErr.message);
          }
        }

        var now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        var who = cred && cred.username ? cred.username : "You";
        // Carry over existing shipNotes to new data — match by vendor name
        var prevNotes = Object.assign({}, sGet("ship-notes-" + whKey) || {}, shipNotes);
        var newGroups = {};
        rows.forEach(function(r) { var k = r.VendorName + " || " + (r.OrderNbr || ""); newGroups[k] = 1; });
        var carried = {};
        Object.keys(newGroups).forEach(function(newKey) {
          // Exact match first
          if (prevNotes[newKey]) { carried[newKey] = prevNotes[newKey]; return; }
          // Try matching by vendor name only (PO# may have changed)
          var newVendor = newKey.split(" || ")[0];
          Object.keys(prevNotes).forEach(function(oldKey) {
            var oldVendor = oldKey.split(" || ")[0];
            if (oldVendor === newVendor && prevNotes[oldKey] && (prevNotes[oldKey].po || prevNotes[oldKey].notes) && !carried[newKey]) {
              carried[newKey] = prevNotes[oldKey];
            }
          });
        });
        setData(rows); setRunBy(who); setRunTime(now); setLoading(false); setSubPage("data"); setShipNotes(carried); setDismissed({}); persist(rows, false, who, now, carried); toast(cfg.label + ": Fetched " + rows.length + " lines");
      } catch (err) {
        setLoading(false);
        toast("Error: " + err.message, "error");
      }
    })();
  }, [whKey, cred, cfg.label, toast, ok, lp, persist]);
  var clearAll = useCallback(async function() { if (!ok) { lp(); return; } setData([]); setSearch(""); setVendorFilter("all"); setFlagsOnly(false); setEmailSent(false); setConfirmClear(false); setRunBy(null); setRunTime(null); setSubPage("overview"); setShipNotes({}); sDel("wh-data-" + whKey); sDel("ship-notes-" + whKey); try { await kvPost(kvKey, {}); } catch (e) {} toast(cfg.label + ": Cleared"); }, [cfg.label, toast, ok, lp, kvKey, whKey]);

  // ─── Acumatica: remove flagged lines from existing POs ───
  var _acuRemove = useState(false), acuRemoveLoading = _acuRemove[0], setAcuRemoveLoading = _acuRemove[1];
  async function removeFromAcumatica(pairs) {
    if (!pairs || pairs.length === 0) return;
    if (!cred || !cred.username || !cred.password) { toast("Acumatica credentials required", "error"); lp && lp(); return; }
    var validPairs = pairs.filter(function(p) { return p && p.orderNbr && p.inventoryID; });
    var missingCount = pairs.length - validPairs.length;
    if (validPairs.length === 0) {
      toast(missingCount > 0 ? "No Inventory IDs available for the selected lines \u2014 try Re-fetch" : "Nothing to remove", "error");
      return;
    }
    var byPO = {};
    validPairs.forEach(function(p) {
      if (!byPO[p.orderNbr]) byPO[p.orderNbr] = [];
      if (byPO[p.orderNbr].indexOf(p.inventoryID) < 0) byPO[p.orderNbr].push(p.inventoryID);
    });
    var removals = Object.keys(byPO).map(function(po) { return { orderNbr: po, skus: byPO[po] }; });
    setAcuRemoveLoading(true);
    try {
      var res = await fetch("/api/acumatica-remove-po-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cred.username, password: cred.password, removals: removals })
      });
      var resp = await res.json();
      if (!resp || !Array.isArray(resp.results)) { toast("Unexpected response from Acumatica", "error"); return; }
      var removedKeys = new Set();
      var removedCount = 0;
      var failedSummaries = [];
      resp.results.forEach(function(r) {
        if (r.ok && Array.isArray(r.removedLines)) {
          r.removedLines.forEach(function(rl) {
            removedCount++;
            if (rl.inventoryID) removedKeys.add(r.orderNbr + "::" + String(rl.inventoryID).trim().toUpperCase());
          });
        } else if (!r.ok) {
          var why = r.stage === "status-check" ? r.orderNbr + " (status: " + (r.currentStatus || "unknown") + ", must be On Hold)" : r.orderNbr + " (" + (r.error || r.stage) + ")";
          failedSummaries.push(why);
        }
      });
      if (removedKeys.size > 0) {
        var nextData = data.filter(function(row) {
          var inv = String(row.InventoryID || "").trim().toUpperCase();
          if (!inv) return true;
          var k = (row.OrderNbr || "") + "::" + inv;
          return !removedKeys.has(k);
        });
        setData(nextData);
        try { persist(nextData, emailSent, runBy, runTime, shipNotes); } catch (e) {}
      }
      if (removedCount > 0 && failedSummaries.length === 0) {
        toast("Removed " + removedCount + " line" + (removedCount > 1 ? "s" : "") + " from Acumatica", "success");
      } else if (removedCount > 0 && failedSummaries.length > 0) {
        toast("Removed " + removedCount + ". Skipped: " + failedSummaries.join("; "), "error");
      } else if (failedSummaries.length > 0) {
        toast("No lines removed. " + failedSummaries.join("; "), "error");
      } else {
        toast("No matching lines found to remove", "error");
      }
    } catch (err) {
      toast("Network error: " + err.message, "error");
    } finally {
      setAcuRemoveLoading(false);
    }
  }

  // ─── Acumatica: Process All POs ───
  var _acuProc = useState(false), acuProcLoading = _acuProc[0], setAcuProcLoading = _acuProc[1];
  var _acuProcConfirm = useState(false), acuProcConfirm = _acuProcConfirm[0], setAcuProcConfirm = _acuProcConfirm[1];
  var _acuSkipConfirm = useState(null), acuSkipConfirm = _acuSkipConfirm[0], setAcuSkipConfirm = _acuSkipConfirm[1];
  var _acuProcResult = useState(null), acuProcResult = _acuProcResult[0], setAcuProcResult = _acuProcResult[1];
  // For categorize modal: { unlabeledVendors: [...], pendingChannels: { vendor: "Email"|... } }
  var _acuCat = useState(null), acuCategorize = _acuCat[0], setAcuCategorize = _acuCat[1];

  // Resolve a vendor's channel from vendorChannels first, then fall back to legacy VENDOR_LABELS.
  // Legacy labels: "Truecommerce" -> "TrueCommerce EDI"; "Website Ordering" -> "Website Ordering".
  // Returns "Email" | "TrueCommerce EDI" | "Website Ordering" | null (unset).
  function getEffectiveChannel(vendorName) {
    var c = vendorChannels[vendorName];
    if (c === "Email" || c === "TrueCommerce EDI" || c === "Website Ordering") return c;
    var legacy = getVendorLabel(vendorName);
    if (legacy === "Truecommerce") return "TrueCommerce EDI";
    if (legacy === "Website Ordering") return "Website Ordering";
    return null;
  }

  // Build the list of POs ready to be processed. Reports:
  //   processable:    ready to fire (all info present)
  //   missingRef:     vendor exists, channel set, but no Vendor Ref entered
  //   missingVendor:  vendor not in Vendor Contacts at all
  //   unlabeled:      vendor in Vendor Contacts but no channel set
  function buildProcessablePOs() {
    var processable = [];
    var missingRef = [];
    var missingVendor = [];
    var unlabeledSet = {};
    Object.keys(vendorGroups).forEach(function(key) {
      var parts = key.split(" || ");
      var vendorName = parts[0], orderNbr = parts[1] || "";
      var sn = shipNotes[key] || {};
      if (sn.done) return;
      if (!orderNbr) return;
      var vendorRef = (sn.notes || "").trim();
      // Check vendor existence in Vendor Contacts
      var inContacts = vendorContacts.hasOwnProperty(vendorName);
      if (!inContacts) {
        missingVendor.push({ key: key, vendorName: vendorName, orderNbr: orderNbr });
        return;
      }
      var channel = getEffectiveChannel(vendorName);
      if (!channel) {
        unlabeledSet[vendorName] = true;
        // Still record so we know which keys are blocked
        return;
      }
      if (!vendorRef) {
        missingRef.push({ key: key, vendorName: vendorName, orderNbr: orderNbr });
        return;
      }
      processable.push({
        key: key,
        vendorName: vendorName,
        orderNbr: orderNbr,
        vendorRef: vendorRef,
        channel: channel
      });
    });
    return { processable: processable, missingRef: missingRef, missingVendor: missingVendor, unlabeledVendors: Object.keys(unlabeledSet) };
  }

  function onProcessAllPOsClick() {
    if (!cred || !cred.username || !cred.password) { toast("Acumatica credentials required", "error"); lp && lp(); return; }
    var built = buildProcessablePOs();
    // (1) Vendors missing from Vendor Contacts entirely
    if (built.missingVendor.length > 0) {
      var miss = built.missingVendor.slice(0, 3).map(function(m) { return m.vendorName; });
      var unique = Array.from(new Set(miss));
      var more = built.missingVendor.length > 3 ? " (+" + (built.missingVendor.length - 3) + " more)" : "";
      toast("Add these vendors first in Settings > Vendor Settings: " + unique.join(", ") + more, "error");
      return;
    }
    // (2) Vendors that exist but have no channel set → open categorize modal
    if (built.unlabeledVendors.length > 0) {
      var pending = {};
      built.unlabeledVendors.forEach(function(v) { pending[v] = ""; });
      setAcuCategorize({ vendors: built.unlabeledVendors, pending: pending });
      return;
    }
    // (3) Missing Vendor Ref on some rows — confirm-and-skip instead of blocking the whole batch
    if (built.missingRef.length > 0) {
      if (built.processable.length === 0) {
        // No rows ready at all — there's nothing to confirm. Just toast.
        toast("Enter at least one Vendor Ref before processing", "error");
        return;
      }
      // Some rows ready, some missing VR. Ask the user to confirm we should process the ready ones
      // and skip the missing-VR rows (so they can fill them in later and re-run).
      setAcuSkipConfirm({ processable: built.processable, missingRef: built.missingRef });
      return;
    }
    if (built.processable.length === 0) {
      toast("Nothing to process \u2014 all rows are done or missing data", "error");
      return;
    }
    if (built.processable.length >= 5) {
      setAcuProcConfirm(true);
    } else {
      processAllPOs(built.processable);
    }
  }

  // Called when user confirms the categorize modal.
  // Saves the picked channels to KV, then auto-continues the Process All POs flow.
  function onCategorizeConfirm() {
    if (!acuCategorize) return;
    var pending = acuCategorize.pending || {};
    // Validate: every unlabeled vendor must have a non-empty channel pick
    var unfilled = acuCategorize.vendors.filter(function(v) { return !pending[v]; });
    if (unfilled.length > 0) {
      toast("Pick a channel for: " + unfilled.slice(0, 3).join(", ") + (unfilled.length > 3 ? "..." : ""), "error");
      return;
    }
    // Save all picks at once
    var newChannels = Object.assign({}, vendorChannels);
    acuCategorize.vendors.forEach(function(v) { newChannels[v] = pending[v]; });
    updateVendorChannels && updateVendorChannels(newChannels);
    setAcuCategorize(null);
    // Auto-continue: re-trigger the Process All POs flow.
    // The dropdown writes update synchronously to React state; small timeout
    // ensures the next render sees vendorChannels updated.
    setTimeout(function() {
      // Build a fresh list using the new channels. Since vendorChannels prop
      // may not have updated by the time this runs, we re-derive locally.
      onProcessAllPOsClick();
    }, 0);
  }

  // Called when user cancels the categorize modal.
  // Saves whatever they DID pick (partial), then aborts without continuing.
  function onCategorizeCancel() {
    if (!acuCategorize) { setAcuCategorize(null); return; }
    var pending = acuCategorize.pending || {};
    var newChannels = Object.assign({}, vendorChannels);
    var saved = 0;
    acuCategorize.vendors.forEach(function(v) { if (pending[v]) { newChannels[v] = pending[v]; saved++; } });
    if (saved > 0) {
      updateVendorChannels && updateVendorChannels(newChannels);
      toast("Saved " + saved + " channel" + (saved > 1 ? "s" : "") + ". Click Process All POs again to continue.", "success");
    }
    setAcuCategorize(null);
  }

  async function processAllPOs(processable) {
    setAcuProcConfirm(false);
    if (!processable) {
      var built = buildProcessablePOs();
      if (built.processable.length === 0) { toast("Nothing to process", "error"); return; }
      processable = built.processable;
    }
    setAcuProcLoading(true);
    setAcuProcResult(null);
    try {
      var posPayload = processable.map(function(p) {
        return { orderNbr: p.orderNbr, vendorRef: p.vendorRef, channel: p.channel };
      });
      var res = await fetch("/api/acumatica-process-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cred.username, password: cred.password, pos: posPayload })
      });
      var resp = await res.json();
      setAcuProcResult({ resp: resp, requested: processable });
      if (!resp || !Array.isArray(resp.results)) {
        toast("Unexpected response from Acumatica", "error");
        return;
      }
      var updatedNotes = Object.assign({}, shipNotes);
      var changed = false;
      resp.results.forEach(function(r, i) {
        if (!r.ok) return;
        var p = processable[i];
        if (!p || !p.key) return;
        // Auto-checkmark Email channel POs (email sent) AND TrueCommerce EDI POs whose
        // EDI send succeeded. Website Ordering POs still need a manual follow-up (vendor
        // website submission), so leave them unchecked.
        if (p.channel === "Email") {
          updatedNotes[p.key] = Object.assign({}, updatedNotes[p.key] || {}, { done: true });
          changed = true;
        } else if (p.channel === "TrueCommerce EDI" && r.ediSent) {
          updatedNotes[p.key] = Object.assign({}, updatedNotes[p.key] || {}, { done: true });
          changed = true;
        }
      });
      if (changed) {
        setShipNotes(updatedNotes);
        try { persist(data, emailSent, runBy, runTime, updatedNotes); } catch (e) {}
      }
      var s = resp.summary || {};
      if (resp.ok) {
        var bits = [];
        if (s.emailedCount) bits.push(s.emailedCount + " emailed");
        if (s.ediSentCount) bits.push(s.ediSentCount + " sent to EDI");
        if (s.vendorRefOnlyCount) bits.push(s.vendorRefOnlyCount + " vendor-ref only");
        toast("Processed " + s.successCount + " POs: " + (bits.join(", ") || "all done"), "success");
      } else {
        var failBits = [];
        if (s.failedCount) failBits.push(s.failedCount + " failed");
        if (s.ediFailedCount) failBits.push(s.ediFailedCount + " EDI failed");
        toast(s.successCount + " succeeded, " + failBits.join(", ") + " \u2014 see results", "error");
      }
    } catch (err) {
      toast("Network error: " + err.message, "error");
    } finally {
      setAcuProcLoading(false);
    }
  }


  var vendorGroups = useMemo(function() { var g = {}; data.forEach(function(r) { var key = r.VendorName + " || " + (r.OrderNbr || ""); if (!g[key]) g[key] = []; g[key].push(r); }); return g; }, [data]);
  var vendorTotals = useMemo(function() { var t = {}; Object.entries(vendorGroups).forEach(function(e) { t[e[0]] = e[1].reduce(function(s, r) { return s + r.TotalPrice; }, 0); }); return t; }, [vendorGroups]);
  var uniqueVendors = useMemo(function() { return Array.from(new Set(data.map(function(r) { return r.VendorName; }))).sort(); }, [data]);
  var totalVal = useMemo(function() { return data.reduce(function(s, r) { return s + r.TotalPrice; }, 0); }, [data]);
  var flags = useMemo(function() { var f = { s: [], so: [] }; data.forEach(function(r, i) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") f.s.push(i); if (mc === "sell-off item") f.so.push(i); }); return f; }, [data]);
  var flagCount = flags.s.length + flags.so.length;
  var emailBlocked = !isGGM && (flags.s.length > 0 || flags.so.length > 0);
  var getFlag = function(r) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") return "short"; if (mc === "sell-off item") return "selloff"; return null; };
  var filtered = useMemo(function() { var d = data.slice(); if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return r.SKUNDC.toLowerCase().indexOf(s) >= 0 || (r.InventoryID || "").toLowerCase().indexOf(s) >= 0 || r.Description.toLowerCase().indexOf(s) >= 0 || r.VendorName.toLowerCase().indexOf(s) >= 0; }); } if (vendorFilter !== "all") d = d.filter(function(r) { return r.VendorName === vendorFilter; }); if (flagsOnly) { var fi = new Set(flags.s.concat(flags.so)); d = d.filter(function(r) { return fi.has(data.indexOf(r)); }); } if (poSort.col) { var col = poSort.col; var dir = poSort.dir; d.sort(function(a, b) { var va, vb; if (col === "Qty") { va = parseFloat(a.OrderQty) || 0; vb = parseFloat(b.OrderQty) || 0; } else if (col === "Vendor") { va = a.VendorName || ""; vb = b.VendorName || ""; return dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb); } else if (col === "PO #") { va = a.OrderNbr || ""; vb = b.OrderNbr || ""; return dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb); } else if (col === "SKU") { va = a.SKUNDC || ""; vb = b.SKUNDC || ""; return dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb); } else if (col === "InventoryID") { va = a.InventoryID || ""; vb = b.InventoryID || ""; return dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb); } else if (col === "Description") { va = a.Description || ""; vb = b.Description || ""; return dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb); } else if (col === "Reorder") { va = parseFloat(a.ReorderPoint) || 0; vb = parseFloat(b.ReorderPoint) || 0; } else if (col === "Max") { va = parseFloat(a.MaxQty) || 0; vb = parseFloat(b.MaxQty) || 0; } else if (col === "Lead") { va = parseFloat(a.LeadTime) || 0; vb = parseFloat(b.LeadTime) || 0; } else if (col === "Min") { va = parseFloat(a.MinOrderQty) || 0; vb = parseFloat(b.MinOrderQty) || 0; } else if (col === "Avail") { va = parseFloat(a.QtyAvailable) || 0; vb = parseFloat(b.QtyAvailable) || 0; } else if (col === "Price") { va = a.Price || 0; vb = b.Price || 0; } else if (col === "Total") { va = a.TotalPrice || 0; vb = b.TotalPrice || 0; } else if (col === "Flag") { va = getFlag(a) ? 0 : 1; vb = getFlag(b) ? 0 : 1; } else { return 0; } return dir === "desc" ? vb - va : va - vb; }); } else { d.sort(function(a, b) { var fa = getFlag(a) ? 0 : 1; var fb = getFlag(b) ? 0 : 1; return fa - fb; }); } return d; }, [data, search, vendorFilter, flagsOnly, flags, poSort]);
  var todayStr = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  function fillTemplate(text) {
    if (!text) return text;
    var now = new Date();
    var weekday = now.toLocaleDateString("en-US", { weekday: "long" });
    var fullDate = now.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
    return text
      .replace(/\{date\}/gi, todayStr)
      .replace(/\{fulldate\}/gi, fullDate)
      .replace(/\{weekday\}/gi, weekday);
  }

  if (initLoading) return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#6B7280" })}><Spinner color={cfg.color} size={20} /></div>;

  return (<div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 4, background: "#F8F9FB", borderRadius: 10, padding: 3 }}>
        {[{ id: "overview", lb: "Overview" }, { id: "data", lb: "PO Data", ct: data.length || null }, { id: "shipping", lb: "Shipping" }, { id: "email", lb: "Email" }].map(function(n) { return <button key={n.id} onClick={function() { setSubPage(n.id); }} style={S.pill(subPage === n.id, cfg.color)}>{n.lb}{n.ct ? <span style={{ fontSize: 10, background: subPage === n.id ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4 }}>{n.ct}</span> : null}</button>; })}
      </div>
      <div style={{ flex: 1 }} />
      {runTime && <span style={{ fontSize: 11, color: "#9CA3AF" }}>Last: {runTime}{runBy ? " by " + runBy : ""}</span>}
      {kvStatus && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: kvStatus.startsWith("verified") || kvStatus.startsWith("loaded-kv") ? "rgba(5,150,105,0.1)" : kvStatus.startsWith("loaded-ls") ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)", color: kvStatus.startsWith("verified") || kvStatus.startsWith("loaded-kv") ? "#059669" : kvStatus.startsWith("loaded-ls") ? "#D97706" : "#DC2626" }}>{kvStatus}</span>}
      {data.length > 0 && <span style={S.badge(emailSent ? "success" : "default")}>{emailSent ? <><IconCheck /> Sent</> : data.length + " lines"}</span>}
      {data.length > 0 && (confirmClear ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: "#DC2626" }}>Clear?</span><button onClick={clearAll} style={Object.assign({}, S.btn("danger"), { padding: "6px 14px", fontSize: 12 })}>Yes</button><button onClick={function() { setConfirmClear(false); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>No</button></div> : <Gate ok={ok} prompt={lp} onClick={function() { setConfirmClear(true); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12, color: "#6B7280" })}><IconTrash /> Clear</Gate>)}
    </div>

    {subPage === "overview" && <div>
      <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 16, padding: "16px 24px" })}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: cfg.color + "20", display: "flex", alignItems: "center", justifyContent: "center", color: cfg.color }}><IconWH /></div>
        <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#1F2937" }}>{cfg.full}</div><div style={{ fontSize: 12, color: "#6B7280" }}>{data.length > 0 ? data.length + " lines · " + uniqueVendors.length + " vendors · $" + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "No data loaded"}</div></div>
        <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 24px" })} onClick={fetchData} disabled={loading}>{loading ? <><Spinner /> Fetching...</> : <><IconRefresh /> {data.length > 0 ? "Re-fetch" : "Run PO Fetch"}</>}</Gate>
      </div>
      {data.length > 0 && <>
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          {[{ l: "Lines", v: data.length, c: cfg.color, bg: "#EEF4FF", lc: "#6B8ABF" }, { l: "Vendors", v: uniqueVendors.length, c: "#059669", bg: "#ECFDF5", lc: "#6B9E8A" }, { l: "Value", v: "$" + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 }), c: "#D97706", bg: "#FEF7EC", lc: "#B08A4A" }, { l: "Flags", v: flagCount || "Clear", c: flagCount ? "#DC2626" : "#059669", bg: flagCount ? "#FEF2F2" : "#ECFDF5", lc: flagCount ? "#C47070" : "#6B9E8A" }].map(function(s) { return <div key={s.l} style={Object.assign({}, S.statCard, { background: s.bg })}><div style={{ fontSize: 11, color: s.lc, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.l}</div><div style={{ fontSize: 28, fontWeight: 500, color: s.c, marginTop: 6 }}>{s.v}</div></div>; })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          {Object.entries(vendorGroups).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) { var key = e[0], rs = e[1], parts = key.split(" || "), v = parts[0], po = parts[1] || "", t = vendorTotals[key], rl = SHIP_RULES[v], st = rl ? evalShip(rl, t) : "No Rule", isFree = st === "Free Shipping", vl = getVendorLabel(v); return <div key={key} style={Object.assign({}, S.card, { padding: "16px 20px", marginBottom: 0 })}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontSize: 13, fontWeight: 600, color: "#1F2937" }}>{v}</div>{vl && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: vl === "Truecommerce" ? "#EFF6FF" : "#FFF7ED", color: vl === "Truecommerce" ? "#2563EB" : "#C2410C", fontWeight: 600 }}>{vl}</span>}</div><div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{rs.length} lines · {po}</div></div><div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937" }}>${t.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div><div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}><IconTruck /><span style={S.badge(isFree ? "success" : "danger")}>{isFree ? <IconCheck /> : <IconAlert />}{st}</span></div></div>; })}
        </div>
      </>}
      {data.length === 0 && !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}><IconWH /><p style={{ marginTop: 12, fontSize: 14 }}>Click <strong>Run PO Fetch</strong> to load data for {cfg.full}.</p></div>}
    </div>}

    {subPage === "data" && <div>
      {flagCount > 0 && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconAlert /><span style={{ fontSize: 13, color: "#DC2626", flex: 1 }}><strong>Flagged:</strong>{flags.s.length > 0 && " " + flags.s.length + " Short-Dating"}{flags.so.length > 0 && " " + flags.so.length + " Sell-Off"}</span>{flags.s.length > 0 && <button disabled={!ok || acuRemoveLoading} onClick={function() { var shortPairs = flags.s.map(function(idx) { var r = data[idx]; return { orderNbr: r.OrderNbr, inventoryID: String(r.InventoryID || "").trim(), skuNDC: r.SKUNDC }; }); removeFromAcumatica(shortPairs); }} title={!ok ? "Acumatica credentials required" : "Remove all short-dating lines from their POs in Acumatica. POs must be On Hold."} style={Object.assign({}, S.btn(), { padding: "6px 12px", fontSize: 12, background: (!ok || acuRemoveLoading) ? "#9CA3AF" : "#DC2626", borderColor: (!ok || acuRemoveLoading) ? "#9CA3AF" : "#DC2626", opacity: (!ok || acuRemoveLoading) ? 0.7 : 1, cursor: (!ok || acuRemoveLoading) ? "not-allowed" : "pointer" })}>{acuRemoveLoading ? <><Spinner /> Removing...</> : "Remove All Short-Dating from POs"}</button>}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
        <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
        <button style={S.btn(flagsOnly ? "danger" : "ghost")} onClick={function() { setFlagsOnly(!flagsOnly); }}><IconFilter /> {flagsOnly ? "Flags" : "Filter Flags"}</button>
        <div style={{ flex: 1 }} /><Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "8px 16px", fontSize: 12 })} onClick={fetchData} disabled={loading}>{loading ? <><Spinner /> Fetching...</> : <><IconRefresh /> Re-fetch</>}</Gate><span style={{ fontSize: 12, color: "#6B7280" }}>{filtered.length}/{data.length}</span>
      </div>
      {data.length > 0 ? <div>
        {Object.keys(dismissed).length > 0 && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "8px 14px", background: "rgba(100,116,139,0.06)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "#6B7280" }}>{Object.keys(dismissed).length} item{Object.keys(dismissed).length > 1 ? "s" : ""} handled</span>
          <button onClick={function() { setDismissed({}); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#3B82F6", fontWeight: 500 }}>Clear all</button>
        </div>}
        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 260px)" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr><th style={Object.assign({}, S.th, { width: 32 })}></th>{["InventoryID", "SKU", "Description", "Qty", "Vendor", "PO #"].concat(!isGGM ? ["Reorder", "Max", "Lead", "Min", "Avail"] : []).concat(["Price", "Total", "Flag"]).map(function(h) { var isSorted = poSort.col === h; return <th key={h} onClick={function() { setPoSort(isSorted ? { col: h, dir: poSort.dir === "asc" ? "desc" : "asc" } : { col: h, dir: h === "Qty" || h === "Price" || h === "Total" || h === "Avail" || h === "Reorder" || h === "Max" || h === "Lead" || h === "Min" ? "desc" : "asc" }); }} style={Object.assign({}, S.th, { cursor: "pointer", userSelect: "none" })}>{h === "InventoryID" ? "Inv ID" : h}{isSorted ? (poSort.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>; })}<th style={Object.assign({}, S.th, { width: 80 })}></th></tr></thead>
          <tbody>{filtered.map(function(r, i) { var f = getFlag(r); var bg = f === "short" ? "rgba(220,38,38,0.04)" : f === "selloff" ? "rgba(217,119,6,0.04)" : "transparent"; var tc = f === "short" ? "#DC2626" : f === "selloff" ? "#D97706" : "#374151"; var fmt = function(v) { var n = parseFloat(v); if (isNaN(n)) return v; return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2); }; var dismissKey = r.SKUNDC + ":" + r.OrderNbr; var isDone = dismissed[dismissKey]; return <tr key={i} style={{ background: bg, opacity: isDone ? 0.4 : 1, transition: "opacity 0.15s" }}><td style={Object.assign({}, S.td, { textAlign: "center", padding: "8px 4px" })}>{f ? <button onClick={function() { var u = Object.assign({}, dismissed); if (isDone) { delete u[dismissKey]; } else { u[dismissKey] = true; } setDismissed(u); }} style={{ width: 20, height: 20, borderRadius: 4, border: isDone ? "2px solid #059669" : "2px solid #D1D5DB", background: isDone ? "#059669" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", flexShrink: 0 }}>{isDone && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}</button> : null}</td><td style={Object.assign({}, S.td, { color: tc, minWidth: 90, whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 11 })}>{r.InventoryID || "\u2014"}</td><td style={Object.assign({}, S.td, { color: tc, minWidth: 120, whiteSpace: "nowrap" })}>{r.SKUNDC}</td><td style={Object.assign({}, S.td, { color: tc, minWidth: 180, maxWidth: 350 })}><CopyCell text={r.Description} toast={toast} color={tc} accentColor={cfg.color} /></td><td style={Object.assign({}, S.td, { color: tc })}>{fmt(r.OrderQty)}</td><td style={Object.assign({}, S.td, { color: tc })}>{r.VendorName}</td><td style={Object.assign({}, S.td, { color: tc })}>{r.OrderNbr}</td>{!isGGM && <><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.ReorderPoint)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.MaxQty)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.LeadTime)}d</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.MinOrderQty)}</td><td style={Object.assign({}, S.td, { color: r.QtyAvailable < 0 ? "#DC2626" : tc, textAlign: "right" })}>{fmt(r.QtyAvailable)}</td></>}<td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>${r.Price.toFixed(2)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>${r.TotalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}>{f ? <span style={S.badge(f === "short" ? "danger" : "warning")}>{f === "short" ? "Short" : "Sell-Off"}</span> : "\u2014"}</td><td style={Object.assign({}, S.td, { textAlign: "center", padding: "8px 4px" })}>{f ? <button disabled={!ok || acuRemoveLoading || !r.InventoryID} onClick={function() { removeFromAcumatica([{ orderNbr: r.OrderNbr, inventoryID: String(r.InventoryID || "").trim(), skuNDC: r.SKUNDC }]); }} title={!ok ? "Acumatica credentials required" : !r.InventoryID ? "No Inventory ID for this line \u2014 try Re-fetch" : "Remove this line from " + r.OrderNbr + " in Acumatica (PO must be On Hold)"} style={{ background: "transparent", border: "1px solid " + ((!ok || acuRemoveLoading || !r.InventoryID) ? "#D1D5DB" : "#DC2626"), color: (!ok || acuRemoveLoading || !r.InventoryID) ? "#9CA3AF" : "#DC2626", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: (!ok || acuRemoveLoading || !r.InventoryID) ? "not-allowed" : "pointer" }}>Remove</button> : null}</td></tr>; })}</tbody>
        </table>
      </div></div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#9CA3AF" })}>Run fetch first.</div>}
    </div>}

    {subPage === "shipping" && <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#6B7280" }}>{(function() { var keys = Object.keys(vendorGroups); var doneCount = keys.filter(function(k) { return (shipNotes[k] || {}).done; }).length; return doneCount > 0 ? <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "#059669", fontWeight: 600 }}>{doneCount}/{keys.length} completed</span><span style={{ color: "#D1D5DB" }}>{"\u00B7"}</span><span>{keys.length - doneCount} remaining</span></span> : keys.length + " vendors"; })()}</div>
        <Gate ok={ok} prompt={lp} title="Re-fetch" style={Object.assign({}, S.btn(), { padding: 0, width: 36, height: 36, minWidth: 36, display: "inline-flex", alignItems: "center", justifyContent: "center" })} onClick={fetchData} disabled={loading}>{loading ? <Spinner /> : <IconRefresh />}</Gate>
      </div>
      {data.length > 0 && (function() {
        var built = buildProcessablePOs();
        var p = built.processable || [];
        var emailCount = p.filter(function(x) { return x.channel === "Email"; }).length;
        var ediCount = p.filter(function(x) { return x.channel === "TrueCommerce EDI"; }).length;
        var webCount = p.filter(function(x) { return x.channel === "Website Ordering"; }).length;
        var blockedMsgs = [];
        if (built.missingVendor && built.missingVendor.length > 0) blockedMsgs.push(built.missingVendor.length + " missing from Vendor Settings");
        if (built.unlabeledVendors && built.unlabeledVendors.length > 0) blockedMsgs.push(built.unlabeledVendors.length + " unlabeled");
        if (built.missingRef && built.missingRef.length > 0) blockedMsgs.push(built.missingRef.length + " missing Vendor Ref");
        var hasReady = p.length > 0;
        var title = hasReady
          ? "Ready to process " + p.length + " PO" + (p.length === 1 ? "" : "s")
          : (blockedMsgs.length > 0 ? "Nothing ready to process" : "All done");
        var subBits = [];
        if (emailCount > 0) subBits.push(emailCount + " Email");
        if (ediCount > 0) subBits.push(ediCount + " TrueCommerce EDI");
        if (webCount > 0) subBits.push(webCount + " Website Ordering");
        var sub = subBits.join(" \u00B7 ");
        if (!sub && blockedMsgs.length > 0) sub = blockedMsgs.join(" \u00B7 ");
        else if (sub && blockedMsgs.length > 0) sub = sub + " \u00B7 " + blockedMsgs.join(" \u00B7 ");
        var btnDisabled = !ok || acuProcLoading || !hasReady;
        return <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1F2937", marginBottom: 4 }}>{title}</div>
            {sub && <div style={{ fontSize: 12, color: "#6B7280" }}>{sub}</div>}
          </div>
          <button disabled={btnDisabled} onClick={onProcessAllPOsClick} title={!ok ? "Acumatica credentials required" : !hasReady ? "Nothing ready to process" : "Per PO: write Vendor Ref, then for Email vendors release Hold + email; for TrueCommerce EDI / Website Ordering vendors leave on Hold."} style={{ background: btnDisabled ? "#D1D5DB" : "#047857", color: "#FFFFFF", border: "none", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: btnDisabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>{acuProcLoading ? <><Spinner /> Processing...</> : <>{"\u2192"} Process All POs</>}</button>
        </div>;
      })()}
      {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr><th style={Object.assign({}, S.th, { width: 40 })}></th>{[{ k: "vendor", l: "Vendor" }, { k: "po", l: "PO #" }, { k: "total", l: "Total", right: true }, { k: "shipping", l: "Shipping" }, { k: null, l: "Vendor Reference", w: 200 }, { k: null, l: "Price Check", w: 100 }].map(function(h) { var isSorted = shipSort.col === h.k; return <th key={h.l} onClick={h.k ? function() { setShipSort(isSorted ? { col: h.k, dir: shipSort.dir === "asc" ? "desc" : "asc" } : { col: h.k, dir: h.k === "total" ? "desc" : "asc" }); } : undefined} style={Object.assign({}, S.th, h.right ? { textAlign: "right" } : {}, h.w ? { width: h.w } : {}, h.k ? { cursor: "pointer", userSelect: "none" } : {})}>{h.l}{isSorted ? (shipSort.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>; })}</tr></thead>
          <tbody>{Object.keys(vendorGroups).sort(function(a, b) { var aDone = (shipNotes[a] || {}).done ? 1 : 0; var bDone = (shipNotes[b] || {}).done ? 1 : 0; if (aDone !== bDone) return aDone - bDone; if (shipSort.col) { var pa = a.split(" || "), pb = b.split(" || "); var va, vb; if (shipSort.col === "vendor") { va = pa[0] || ""; vb = pb[0] || ""; return shipSort.dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb); } else if (shipSort.col === "po") { va = pa[1] || ""; vb = pb[1] || ""; return shipSort.dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb); } else if (shipSort.col === "total") { va = vendorTotals[a] || 0; vb = vendorTotals[b] || 0; return shipSort.dir === "desc" ? vb - va : va - vb; } else if (shipSort.col === "shipping") { var ra = SHIP_RULES[pa[0]] || ""; var rb = SHIP_RULES[pb[0]] || ""; var sa = ra ? (evalShip(ra, vendorTotals[a]) === "Free Shipping" ? 1 : 0) : -1; var sb = rb ? (evalShip(rb, vendorTotals[b]) === "Free Shipping" ? 1 : 0) : -1; return shipSort.dir === "desc" ? sb - sa : sa - sb; } } return a.localeCompare(b); }).map(function(key) { var parts = key.split(" || "), v = parts[0], po = parts[1] || ""; var t = vendorTotals[key], rl = SHIP_RULES[v] || "", st = rl ? evalShip(rl, t) : "No Rule", isFree = st === "Free Shipping"; var sn = shipNotes[key] || {}; var vl = getVendorLabel(v); var rows = vendorGroups[key] || []; var checkedCount = rows.filter(function(r) { return priceChecked[key + ":" + r.SKUNDC]; }).length; var isDone = sn.done; return <tr key={key} style={{ opacity: isDone ? 0.45 : 1, transition: "opacity 0.2s" }}><td style={Object.assign({}, S.td, { textAlign: "center", padding: "8px 4px" })}><button onClick={function() { var updated = Object.assign({}, shipNotes); updated[key] = Object.assign({}, sn, { done: !isDone }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} style={{ width: 24, height: 24, borderRadius: 6, border: isDone ? "2px solid #059669" : "2px solid #D1D5DB", background: isDone ? "#059669" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", flexShrink: 0 }}>{isDone && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}</button></td><td style={Object.assign({}, S.td, { color: "#1F2937", textDecoration: isDone ? "line-through" : "none" })}><div>{v}</div>{vl && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: vl === "Truecommerce" ? "#EFF6FF" : "#FFF7ED", color: vl === "Truecommerce" ? "#2563EB" : "#C2410C", fontWeight: 600, display: "inline-block", marginTop: 4 }}>{vl}</span>}</td><td style={Object.assign({}, S.td, { color: "#374151" })}>{po || <input style={Object.assign({}, S.inp, { padding: "6px 10px" })} placeholder="Paste PO #" value={sn.po || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[key] = Object.assign({}, sn, { po: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} />}</td><td style={Object.assign({}, S.td, { textAlign: "right" })}>${t.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}><span style={S.badge(isFree ? "success" : "danger")}>{isFree ? <IconCheck /> : <IconAlert />}{st}</span></td><td style={S.td}><input style={Object.assign({}, S.inp, { padding: "6px 10px" })} placeholder="Paste PO #..." value={sn.notes || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[key] = Object.assign({}, sn, { notes: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} /></td><td style={Object.assign({}, S.td, { textAlign: "center" })}><button onClick={function() { setPriceCheckKey(key); }} style={Object.assign({}, S.btn("ghost"), { padding: "4px 10px", fontSize: 11 })}>{checkedCount === rows.length && rows.length > 0 ? <><IconCheck /> All</> : checkedCount > 0 ? checkedCount + "/" + rows.length : "Review"}</button></td></tr>; })}</tbody>
        </table>
      </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#9CA3AF" })}>Run fetch first.</div>}
      <a href="https://docs.google.com/spreadsheets/d/1jZ6DLCpinlhUlNEnPkKTO65PQt_33G7hLqbiaI3LXKw/edit?gid=1331205333#gid=1331205333" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", marginTop: 16, background: "#EEF4FF", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 12, textDecoration: "none", transition: "all 0.15s", cursor: "pointer" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(59,130,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1E40AF" }}>SFTP EDI PO Export Tool</div>
          <div style={{ fontSize: 12, color: "#6B8ABF", marginTop: 1 }}>Open in Google Sheets</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#93BBFC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
      </a>

      {/* Categorize Vendors Modal — shown when some vendors have no channel set */}
      {acuCategorize && <div onClick={onCategorizeCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
        <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#FFFFFF", borderRadius: 12, padding: 24, maxWidth: 620, width: "92%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginBottom: 8 }}>Set Channel for {acuCategorize.vendors.length} Vendor{acuCategorize.vendors.length > 1 ? "s" : ""}</div>
          <div style={{ fontSize: 13, color: "#374151", marginBottom: 16, lineHeight: 1.5 }}>
            These vendors don't have a channel set yet. Pick how Acumatica should handle their POs. Your choices save to Vendor Contacts and will be remembered for future runs.
          </div>
          <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "auto", maxHeight: 360, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#F9FAFB", position: "sticky", top: 0 }}><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Vendor</th><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600, width: 220 }}>Channel</th></tr></thead>
              <tbody>{acuCategorize.vendors.map(function(vname) {
                return <tr key={vname} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td style={{ padding: "8px 12px", color: "#1F2937" }}>{vname}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <select value={acuCategorize.pending[vname] || ""} onChange={function(ev) { var p = Object.assign({}, acuCategorize.pending); p[vname] = ev.target.value; setAcuCategorize(Object.assign({}, acuCategorize, { pending: p })); }} style={{ padding: "5px 8px", fontSize: 12, width: "100%", borderRadius: 6, border: "1px solid #D1D5DB" }}>
                      <option value="">— select —</option>
                      <option value="Email">Email</option>
                      <option value="TrueCommerce EDI">TrueCommerce EDI</option>
                      <option value="Website Ordering">Website Ordering</option>
                    </select>
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button onClick={onCategorizeCancel} style={S.btn("ghost")}>Cancel</button>
            <button onClick={onCategorizeConfirm} style={Object.assign({}, S.btn(), { background: "#047857", borderColor: "#047857" })}>Save &amp; Continue</button>
          </div>
        </div>
      </div>}

      {/* Process All POs — Skip Missing-VR Confirmation Modal */}
      {acuSkipConfirm && (function() {
        var ready = acuSkipConfirm.processable || [];
        var missing = acuSkipConfirm.missingRef || [];
        var missPreview = missing.slice(0, 5).map(function(m) { return m.vendorName + " (" + m.orderNbr + ")"; });
        var missMore = missing.length > 5 ? missing.length - 5 : 0;
        return <div onClick={function() { setAcuSkipConfirm(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#FFFFFF", borderRadius: 12, padding: 24, maxWidth: 520, width: "94%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginBottom: 12 }}>Process {ready.length} of {ready.length + missing.length} POs?</div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16, lineHeight: 1.55 }}>
              <strong style={{ color: "#047857" }}>{ready.length}</strong> {ready.length === 1 ? "PO has" : "POs have"} a Vendor Ref and will be processed now.
              <br /><strong style={{ color: "#6B7280" }}>{missing.length}</strong> {missing.length === 1 ? "PO is" : "POs are"} missing a Vendor Ref and will be skipped \u2014 you can fill them in and re-run later.
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16, padding: "8px 12px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Skipping:</div>
              {missPreview.map(function(s, i) { return <div key={i} style={{ fontFamily: "monospace" }}>{"\u00B7 " + s}</div>; })}
              {missMore > 0 && <div style={{ marginTop: 4, fontStyle: "italic" }}>+ {missMore} more</div>}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={function() { setAcuSkipConfirm(null); }} style={S.btn("ghost")}>Cancel</button>
              <button onClick={function() {
                var p = ready;
                setAcuSkipConfirm(null);
                if (p.length >= 5) setAcuProcConfirm(true);
                else processAllPOs(p);
              }} style={Object.assign({}, S.btn(), { background: "#047857", borderColor: "#047857" })}>Process {ready.length} {ready.length === 1 ? "PO" : "POs"}</button>
            </div>
          </div>
        </div>;
      })()}

      {/* Process All POs — Confirmation Modal (only shown for 5+ POs) */}
      {acuProcConfirm && (function() {
        var built = buildProcessablePOs();
        var p = built.processable;
        var emailCount = p.filter(function(x) { return x.channel === "Email"; }).length;
        var holdCount = p.length - emailCount;
        return <div onClick={function() { setAcuProcConfirm(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#FFFFFF", borderRadius: 12, padding: 24, maxWidth: 720, width: "94%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginBottom: 8 }}>Confirm Process All POs</div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16, lineHeight: 1.5 }}>
              About to process <strong>{p.length} POs</strong>: {emailCount} will be released and emailed; {holdCount} will get Vendor Ref written but stay On Hold (TrueCommerce EDI / Website Ordering). <strong>Email is irreversible</strong> — sent emails cannot be unsent.
            </div>
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, maxHeight: 320, overflow: "auto", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#F9FAFB", position: "sticky", top: 0 }}><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Vendor</th><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>PO #</th><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Vendor Ref</th><th style={{ padding: "8px 12px", textAlign: "center", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Channel</th><th style={{ padding: "8px 12px", textAlign: "center", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Action</th></tr></thead>
                <tbody>{p.map(function(row, i) {
                  var actionText, actionColor;
                  if (row.channel === "Email") { actionText = "Release + Email"; actionColor = "#059669"; }
                  else if (row.channel === "TrueCommerce EDI") { actionText = "Release + Send to EDI"; actionColor = "#2563EB"; }
                  else { actionText = "Vendor Ref only"; actionColor = "#C2410C"; }
                  return <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}><td style={{ padding: "6px 12px", color: "#1F2937" }}>{row.vendorName}</td><td style={{ padding: "6px 12px", color: "#374151", fontFamily: "monospace" }}>{row.orderNbr}</td><td style={{ padding: "6px 12px", color: "#374151", fontFamily: "monospace" }}>{row.vendorRef}</td><td style={{ padding: "6px 12px", textAlign: "center", color: "#6B7280", fontSize: 11 }}>{row.channel}</td><td style={{ padding: "6px 12px", textAlign: "center", color: actionColor, fontWeight: 600 }}>{actionText}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={function() { setAcuProcConfirm(false); }} style={S.btn("ghost")}>Cancel</button>
              <button onClick={function() { processAllPOs(p); }} style={Object.assign({}, S.btn(), { background: "#047857", borderColor: "#047857" })}>Yes, Process {p.length} POs</button>
            </div>
          </div>
        </div>;
      })()}

      {/* Process All POs — Results Modal */}
      {acuProcResult && (function() {
        var r = acuProcResult.resp || {};
        var s = r.summary || {};
        var rs = Array.isArray(r.results) ? r.results : [];
        return <div onClick={function() { setAcuProcResult(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#FFFFFF", borderRadius: 12, padding: 24, maxWidth: 760, width: "94%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937" }}>Process Results</div>
              <button onClick={function() { setAcuProcResult(null); }} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6B7280" }}>{"\u00D7"}</button>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ padding: "8px 14px", background: "#ECFDF5", color: "#059669", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{s.successCount || 0} succeeded</div>
              {s.emailedCount > 0 && <div style={{ padding: "8px 14px", background: "#EFF6FF", color: "#2563EB", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{s.emailedCount} emailed</div>}
              {s.ediSentCount > 0 && <div style={{ padding: "8px 14px", background: "#EFF6FF", color: "#2563EB", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{s.ediSentCount} sent to EDI</div>}
              {s.vendorRefOnlyCount > 0 && <div style={{ padding: "8px 14px", background: "#FFF7ED", color: "#C2410C", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{s.vendorRefOnlyCount} vendor-ref only</div>}
              {s.ediFailedCount > 0 && <div style={{ padding: "8px 14px", background: "#FEF2F2", color: "#DC2626", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{s.ediFailedCount} EDI failed</div>}
              {s.failedCount > 0 && <div style={{ padding: "8px 14px", background: "#FEF2F2", color: "#DC2626", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{s.failedCount} failed</div>}
            </div>
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "auto", maxHeight: "55vh" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#F9FAFB", position: "sticky", top: 0 }}><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>PO #</th><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Vendor Ref</th><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Channel</th><th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>Result</th></tr></thead>
                <tbody>{rs.map(function(row, i) {
                  var resultText, resultColor;
                  if (row.ok && row.emailed) { resultText = "\u2713 Released + Emailed"; resultColor = "#059669"; }
                  else if (row.ok && row.ediSent) { resultText = "\u2713 Released + Sent to EDI"; resultColor = "#059669"; }
                  else if (row.ok && row.pendingEdiSend && !row.ediSent) { resultText = "\u26A0 Released but EDI failed: " + (row.ediError || "unknown"); resultColor = "#DC2626"; }
                  else if (row.ok && row.emailSkipped && row.channel === "Website Ordering") { resultText = "\u2713 Vendor Ref written (still On Hold)"; resultColor = "#059669"; }
                  else if (row.ok && row.emailError) { resultText = "\u26A0 Released but email failed"; resultColor = "#D97706"; }
                  else if (row.stage === "status-check") { resultText = "\u2717 Skipped: " + (row.currentStatus || "not on hold"); resultColor = "#DC2626"; }
                  else if (row.stage === "read-po") { resultText = "\u2717 PO not found"; resultColor = "#DC2626"; }
                  else { resultText = "\u2717 " + (row.error || row.stage || "unknown error"); resultColor = "#DC2626"; }
                  return <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}><td style={{ padding: "6px 12px", color: "#1F2937", fontFamily: "monospace" }}>{row.orderNbr}</td><td style={{ padding: "6px 12px", color: "#374151", fontFamily: "monospace" }}>{row.requestedVendorRef || ""}</td><td style={{ padding: "6px 12px", color: "#6B7280", fontSize: 11 }}>{row.channel || ""}</td><td style={{ padding: "6px 12px", color: resultColor, fontWeight: 600 }}>{resultText}{row.emailError && row.emailError.errorDetails ? <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 400, marginTop: 2 }}>{row.emailError.errorDetails.map(function(e) { return e.message; }).join("; ")}</div> : null}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button onClick={function() { setAcuProcResult(null); }} style={S.btn()}>Close</button>
            </div>
          </div>
        </div>;
      })()}
    </div>}

    {/* Price Check Modal */}
    {priceCheckKey && (function() {
      var parts = priceCheckKey.split(" || ");
      var vendorName = parts[0], poNum = parts[1] || "";
      var rows = vendorGroups[priceCheckKey] || [];
      var sortedRows = rows;
      if (pcSort) {
        var withIdx = rows.map(function(r, i) { return { r: r, i: i }; });
        withIdx.sort(function(a, b) {
          var ra = a.r, rb = b.r;
          var av, bv;
          if (pcSort.col === "sku") { av = String(ra.SKUNDC || ""); bv = String(rb.SKUNDC || ""); return pcSort.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv); }
          if (pcSort.col === "desc") { av = String(ra.Description || ""); bv = String(rb.Description || ""); return pcSort.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv); }
          if (pcSort.col === "qty") { av = ra.OrderQty || 0; bv = rb.OrderQty || 0; return pcSort.dir === "desc" ? bv - av : av - bv; }
          if (pcSort.col === "unit") { av = ra.Price || 0; bv = rb.Price || 0; return pcSort.dir === "desc" ? bv - av : av - bv; }
          if (pcSort.col === "total") { av = ra.TotalPrice || 0; bv = rb.TotalPrice || 0; return pcSort.dir === "desc" ? bv - av : av - bv; }
          if (pcSort.col === "reported") {
            var ka = priceCheckKey + ":" + ra.SKUNDC, kb = priceCheckKey + ":" + rb.SKUNDC;
            av = parseFloat(String(pcReported[ka] || "").replace(/[$,]/g, "")); bv = parseFloat(String(pcReported[kb] || "").replace(/[$,]/g, ""));
            if (isNaN(av) && isNaN(bv)) return a.i - b.i;
            if (isNaN(av)) return 1;
            if (isNaN(bv)) return -1;
            return pcSort.dir === "desc" ? bv - av : av - bv;
          }
          if (pcSort.col === "reportedUnit") {
            var ka2 = priceCheckKey + ":" + ra.SKUNDC, kb2 = priceCheckKey + ":" + rb.SKUNDC;
            var rn_a = parseFloat(String(pcReported[ka2] || "").replace(/[$,]/g, "")), rn_b = parseFloat(String(pcReported[kb2] || "").replace(/[$,]/g, ""));
            av = !isNaN(rn_a) && ra.OrderQty > 0 ? rn_a / ra.OrderQty : null;
            bv = !isNaN(rn_b) && rb.OrderQty > 0 ? rn_b / rb.OrderQty : null;
            if (av == null && bv == null) return a.i - b.i;
            if (av == null) return 1;
            if (bv == null) return -1;
            return pcSort.dir === "desc" ? bv - av : av - bv;
          }
          return a.i - b.i;
        });
        sortedRows = withIdx.map(function(x) { return x.r; });
      }
      var total = rows.reduce(function(s, r) { return s + (r.TotalPrice || 0); }, 0);
      var allChecked = rows.length > 0 && rows.every(function(r) { return priceChecked[priceCheckKey + ":" + r.SKUNDC]; });
      var checkedCount = rows.filter(function(r) { return priceChecked[priceCheckKey + ":" + r.SKUNDC]; }).length;
      var uncheckedItems = rows.filter(function(r) { return !priceChecked[priceCheckKey + ":" + r.SKUNDC]; });
      return <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.35)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={function(e) { if (e.target === e.currentTarget) setPriceCheckKey(null); }}>
        <div style={{ background: "#FFFFFF", borderRadius: 20, maxWidth: 1100, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)" }}>
          {/* Header */}
          <div style={{ padding: "24px 32px 20px", borderBottom: "1px solid #F3F4F6" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", letterSpacing: "-0.01em" }}>Price Check</div>
                <div style={{ fontSize: 14, color: "#4B5563", marginTop: 4 }}>{vendorName}{poNum && <span style={{ color: "#9CA3AF" }}> · {poNum}</span>}</div>
              </div>
              <button onClick={function() { setPriceCheckKey(null); }} style={{ background: "#F9FAFB", border: "none", cursor: "pointer", fontSize: 16, color: "#6B7280", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>{"\u00D7"}</button>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 16, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
                <div><span style={{ color: "#6B7280" }}>Items</span> <span style={{ fontWeight: 600, color: "#1F2937" }}>{rows.length}</span></div>
                <div><span style={{ color: "#6B7280" }}>Total</span> <span style={{ fontWeight: 600, color: "#1F2937" }}>${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                <div><span style={{ color: "#6B7280" }}>Verified</span> <span style={{ fontWeight: 600, color: allChecked ? "#059669" : checkedCount > 0 ? "#D97706" : "#6B7280" }}>{checkedCount}/{rows.length}</span></div>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={function() { var updated = Object.assign({}, priceChecked); rows.forEach(function(r) { updated[priceCheckKey + ":" + r.SKUNDC] = !allChecked; }); setPriceChecked(updated); }} style={Object.assign({}, S.btn(allChecked ? "ghost" : "default"), { padding: "8px 16px", fontSize: 12 })}>{allChecked ? "Uncheck All" : "Check All"}</button>
            </div>
            {/* Progress bar */}
            <div style={{ marginTop: 12, height: 3, background: "#F3F4F6", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: rows.length > 0 ? (checkedCount / rows.length * 100) + "%" : "0%", background: allChecked ? "#059669" : "#D97706", borderRadius: 2, transition: "width 0.3s ease" }} />
            </div>
          </div>
          {/* Column headers */}
          {(function() {
            function hdr(col, label, opts) {
              opts = opts || {};
              var isSorted = pcSort && pcSort.col === col;
              var arrow = isSorted ? (pcSort.dir === "desc" ? " \u25BE" : " \u25B4") : "";
              return <div onClick={function() { setPcSort(isSorted ? (pcSort.dir === "desc" ? { col: col, dir: "asc" } : null) : { col: col, dir: "desc" }); }} style={Object.assign({ cursor: "pointer", userSelect: "none", color: isSorted ? "#374151" : "#9CA3AF" }, opts)}>{label}{arrow}</div>;
            }
            return <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 32px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6", fontSize: 10, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              <div style={{ width: 22 }}></div>
              {hdr("sku", "SKU", { minWidth: 110 })}
              {hdr("desc", "Description", { flex: 1 })}
              {hdr("qty", "Qty", { textAlign: "right", minWidth: 40 })}
              {hdr("unit", "Unit Price", { textAlign: "right", minWidth: 75 })}
              {hdr("total", "Total", { textAlign: "right", minWidth: 95 })}
              <div style={{ width: 1, height: 14, background: "#E5E7EB", margin: "0 4px" }}></div>
              {hdr("reported", "Reported", { textAlign: "right", minWidth: 90 })}
              {hdr("reportedUnit", "Unit Cost", { textAlign: "right", minWidth: 75 })}
            </div>;
          })()}
          {/* Item list */}
          <div style={{ overflow: "auto", flex: 1, padding: "4px 16px" }}>
            {sortedRows.map(function(r, i) {
              var ck = priceChecked[priceCheckKey + ":" + r.SKUNDC] || false;
              var rKey = priceCheckKey + ":" + r.SKUNDC;
              var reported = pcReported[rKey] || "";
              var reportedNum = parseFloat(String(reported).replace(/[$,]/g, ""));
              var reportedUnit = !isNaN(reportedNum) && r.OrderQty > 0 ? reportedNum / r.OrderQty : null;
              return <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", margin: "2px 0", borderRadius: 10, cursor: "pointer", transition: "all 0.15s", background: ck ? "rgba(5,150,105,0.04)" : "transparent", border: ck ? "1px solid rgba(5,150,105,0.12)" : "1px solid transparent" }}>
                <div onClick={function() { var updated = Object.assign({}, priceChecked); updated[rKey] = !ck; setPriceChecked(updated); }} style={{ width: 22, height: 22, borderRadius: 6, border: ck ? "2px solid #059669" : "2px solid #D1D5DB", background: ck ? "#059669" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s", cursor: "pointer" }}>
                  {ck && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                </div>
                <div style={{ minWidth: 110, fontFamily: "monospace", fontSize: 12, color: ck ? "#059669" : "#374151", fontWeight: 500 }}>{r.SKUNDC}</div>
                <div onClick={function() { var updated = Object.assign({}, priceChecked); updated[rKey] = !ck; setPriceChecked(updated); }} style={{ flex: 1, fontSize: 13, color: ck ? "#059669" : "#374151", lineHeight: 1.4, cursor: "pointer" }}>{r.Description}</div>
                <div style={{ textAlign: "right", minWidth: 40, fontSize: 13, color: ck ? "#059669" : "#6B7280" }}>{r.OrderQty}</div>
                <div style={{ textAlign: "right", minWidth: 75, fontSize: 13, color: ck ? "#059669" : "#374151" }}>${r.Price.toFixed(2)}</div>
                <div style={{ textAlign: "right", minWidth: 95, fontSize: 13, fontWeight: 600, color: ck ? "#059669" : "#1F2937" }}>${r.TotalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                <div style={{ width: 1, height: 28, background: "#F3F4F6", margin: "0 4px", flexShrink: 0 }}></div>
                <div style={{ minWidth: 90 }} onClick={function(e) { e.stopPropagation(); }}>
                  <input value={reported} onChange={function(e) { var u = Object.assign({}, pcReported); u[rKey] = e.target.value; setPcReported(u); }} placeholder="$0.00" style={{ width: 85, padding: "5px 8px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, textAlign: "right", outline: "none", background: reported ? "#FFFFFF" : "#F9FAFB", color: "#374151" }} />
                </div>
                <div style={{ textAlign: "right", minWidth: 85, fontSize: 12, fontWeight: 600, color: reportedUnit !== null ? (Math.abs(reportedUnit - r.Price) < 0.01 ? "#059669" : "#DC2626") : "#9CA3AF", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                  {reportedUnit !== null ? <>{Math.abs(reportedUnit - r.Price) < 0.01 ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}{"$" + reportedUnit.toFixed(4)}</> : "\u2014"}
                </div>
              </div>;
            })}
          </div>
          {/* Footer */}
          {uncheckedItems.length > 0 && uncheckedItems.length < rows.length && <div style={{ padding: "14px 32px", borderTop: "1px solid #F3F4F6", background: "rgba(245,158,11,0.04)", fontSize: 12, color: "#D97706", lineHeight: 1.5 }}>
            <strong>{uncheckedItems.length} item{uncheckedItems.length > 1 ? "s" : ""} remaining:</strong> {uncheckedItems.map(function(r) { return r.SKUNDC; }).join(", ")}
          </div>}
          {allChecked && <div style={{ padding: "16px 32px", borderTop: "1px solid #F3F4F6", background: "rgba(5,150,105,0.04)", fontSize: 14, color: "#059669", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <IconCheck /> All prices verified
          </div>}
        </div>
      </div>;
    })()}

    {subPage === "email" && <div>
      {emailBlocked && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconAlert /><span style={{ fontSize: 13, color: "#DC2626" }}><strong>{flagCount} flagged item{flagCount > 1 ? "s" : ""}</strong>{flags.s.length > 0 ? " (" + flags.s.length + " short-dating)" : ""}{flags.so.length > 0 ? " (" + flags.so.length + " sell-off)" : ""} must be removed from the PO before sending.</span></div>}
      {emailSent && <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconCheck /><span style={{ fontSize: 13, color: "#059669" }}><strong>Draft created!</strong></span></div>}
      <div style={S.card}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, width: 60, paddingTop: 8 }}>To:</span>
            {editingField === "to" ? <>
              <input value={emailTo} onChange={function(e) { setEmailTo(e.target.value); }} autoFocus onBlur={function() { persistEmailOverride({ to: emailTo }); setEditingField(null); }} onKeyDown={function(e) { if (e.key === "Enter") { persistEmailOverride({ to: emailTo }); setEditingField(null); } if (e.key === "Escape") setEditingField(null); }} placeholder="recipient@example.com, recipient2@example.com" style={Object.assign({}, S.inp, { padding: "6px 10px", fontSize: 13, flex: 1 })} />
            </> : <>
              <span style={{ fontSize: 13, color: "#374151", flex: 1, paddingTop: 7, wordBreak: "break-all" }}>{emailTo || <span style={{ color: "#9CA3AF" }}>No recipients set</span>}</span>
              <button onClick={function() { setEditingField("to"); }} title="Edit recipients" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 14, padding: 4, alignSelf: "center" }}>{"\u270E"}</button>
            </>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, width: 60, paddingTop: 8 }}>Subject:</span>
            {editingField === "subject" ? <>
              <input value={emailSubject || cfg.subjectFn(todayStr)} onChange={function(e) { setEmailSubject(e.target.value); }} autoFocus onBlur={function() { persistEmailOverride({ subject: emailSubject }); setEditingField(null); }} onKeyDown={function(e) { if (e.key === "Enter") { persistEmailOverride({ subject: emailSubject }); setEditingField(null); } if (e.key === "Escape") setEditingField(null); }} placeholder={cfg.subjectFn(todayStr)} style={Object.assign({}, S.inp, { padding: "6px 10px", fontSize: 13, flex: 1, fontWeight: 600 })} />
            </> : <>
              <span style={{ fontSize: 13, color: "#1F2937", fontWeight: 600, flex: 1, paddingTop: 7 }}>{fillTemplate(emailSubject) || cfg.subjectFn(todayStr)}</span>
              <button onClick={function() { setEditingField("subject"); }} title="Edit subject" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 14, padding: 4, alignSelf: "center" }}>{"\u270E"}</button>
            </>}
          </div>
          <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 16, marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              {editingField === "body" ? <button onClick={function() { persistEmailOverride({ body: emailBody }); setEditingField(null); }} style={Object.assign({}, S.btn(), { padding: "4px 12px", fontSize: 11 })}>Save</button> : <button onClick={function() { setEditingField("body"); }} title="Edit body" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 14, padding: 4 }}>{"\u270E"}</button>}
            </div>
            {editingField === "body" ? <textarea value={emailBody} onChange={function(e) { setEmailBody(e.target.value); }} autoFocus rows={6} style={Object.assign({}, S.inp, { padding: "10px 12px", fontSize: 13, lineHeight: 1.6, color: "#374151", width: "100%", resize: "vertical", fontFamily: "'Varela Round', sans-serif" })} /> : <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", padding: "8px 0" }}>{fillTemplate(emailBody)}</div>}
            <div style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic", marginTop: 6 }}>{"Your Vetcove Gmail signature will be appended automatically \u00B7 Use {date}, {weekday}, or {fulldate} as placeholders"}</div>
          </div>
        </div>
        <div style={{ marginTop: 20, borderTop: "1px solid #E5E7EB", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, textTransform: "uppercase" }}>Attachments ({(function() { var sel = emailSelected || {}; var count = uniqueVendors.filter(function(v) { return emailSelected === null || sel[v] !== false; }).length; return count; })()}/{uniqueVendors.length})</div>
            <button onClick={function() { var allSelected = emailSelected === null || uniqueVendors.every(function(v) { return emailSelected[v] !== false; }); var updated = {}; uniqueVendors.forEach(function(v) { updated[v] = allSelected ? false : true; }); setEmailSelected(allSelected ? updated : null); }} style={Object.assign({}, S.btn("ghost"), { padding: "4px 12px", fontSize: 11 })}>{emailSelected === null || uniqueVendors.every(function(v) { return emailSelected[v] !== false; }) ? "Deselect All" : "Select All"}</button>
          </div>
          {uniqueVendors.map(function(v) { var count = data.filter(function(r) { return r.VendorName === v; }).length; var isChecked = emailSelected === null || emailSelected[v] !== false; return <div key={v} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: isChecked ? "#F8F9FB" : "transparent", borderRadius: 8, marginBottom: 4, border: isChecked ? "1px solid #E5E7EB" : "1px solid transparent", transition: "all 0.15s", opacity: isChecked ? 1 : 0.5 }}>
            <div onClick={function() { var updated = Object.assign({}, emailSelected || {}); if (emailSelected === null) { uniqueVendors.forEach(function(uv) { updated[uv] = true; }); } updated[v] = !isChecked; setEmailSelected(updated); }} style={{ width: 18, height: 18, borderRadius: 4, border: isChecked ? "2px solid " + cfg.color : "2px solid #D1D5DB", background: isChecked ? cfg.color : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s", cursor: "pointer" }}>
              {isChecked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            </div>
            <span onClick={function(e) { e.stopPropagation(); try { var XLSX = require("xlsx"); var xlsCols = isGGM ? ["SKU", "Description", "Qty", "Vendor", "Price", "Total"] : ["SKU", "Description", "Qty", "Vendor", "PO #", "Reorder", "Max", "Lead", "Min", "Avail", "Price", "Total"]; var rows = data.filter(function(r) { return r.VendorName === v; }).map(function(r) { return isGGM ? [r.SKUNDC, r.Description, r.OrderQty, r.VendorName, r.Price, r.TotalPrice] : [r.SKUNDC, r.Description, r.OrderQty, r.VendorName, r.OrderNbr, r.ReorderPoint, r.MaxQty, r.LeadTime, r.MinOrderQty, r.QtyAvailable, r.Price, r.TotalPrice]; }); var ws = XLSX.utils.aoa_to_sheet([xlsCols].concat(rows)); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PO Data"); XLSX.writeFile(wb, v + " PO Data - " + whKey + ".xlsx"); toast("Downloaded " + v + " (" + rows.length + " rows)"); } catch (err) { toast("Download error: " + err.message, "error"); } }} style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#3B82F6", background: "rgba(59,130,246,0.1)", borderRadius: 6, padding: 4 }} title="Download this file"><IconDL /></span><span onClick={function() { var updated = Object.assign({}, emailSelected || {}); if (emailSelected === null) { uniqueVendors.forEach(function(uv) { updated[uv] = true; }); } updated[v] = !isChecked; setEmailSelected(updated); }} style={{ fontSize: 12, color: isChecked ? "#4B5563" : "#9CA3AF", cursor: "pointer", flex: 1 }}>{v} PO Data - {whKey}.xlsx</span>
            <span style={{ fontSize: 11, color: "#9CA3AF", minWidth: 50, textAlign: "right" }}>{count} rows</span>
          </div>; })}
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <div title={emailBlocked ? "Short-dated/Sell-Off Items Detected" : undefined}>
          <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 24px", opacity: (emailSent || emailLoading || emailBlocked) ? 0.5 : 1, cursor: emailBlocked ? "not-allowed" : undefined })} onClick={async function() {
            if (emailBlocked) { toast("Remove all flagged items (short-dating / sell-off) before sending email", "error"); return; }
            if (!gmail || !gmail.token) { toast("Please connect your Gmail account first (bottom-left)", "error"); return; }
            var selectedVendors = uniqueVendors.filter(function(v) { return emailSelected === null || emailSelected[v] !== false; });
            if (selectedVendors.length === 0) { toast("Select at least one vendor attachment", "error"); return; }
            setEmailLoading(true);
            try {
              var toLine = emailTo;
              var subject = fillTemplate(emailSubject) || cfg.subjectFn(todayStr);
              var safeBody = fillTemplate(emailBody || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              var htmlBody = "<p>" + safeBody.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
              var xlsCols = ["SKU", "Description", "Qty", "Vendor", "PO #", "Reorder", "Max", "Lead", "Min", "Avail", "Price", "Total"];
              var attachments = selectedVendors.map(function(v) {
                var rows = data.filter(function(r) { return r.VendorName === v; }).map(function(r) {
                  return [r.SKUNDC, r.Description, r.OrderQty, r.VendorName, r.OrderNbr, r.ReorderPoint, r.MaxQty, r.LeadTime, r.MinOrderQty, r.QtyAvailable, r.Price, r.TotalPrice];
                });
                return { filename: v + " PO Data - " + whKey + ".xlsx", columns: xlsCols, rows: rows };
              });
              var draftPayloads = [{ to: toLine, subject: subject, htmlBody: htmlBody, attachments: attachments }];
              var result = await postGmailDrafts(draftPayloads, gmail.token);
              if (result.failed > 0) throw new Error("Some drafts failed to create");
              setEmailSent(true); persist(data, true, runBy, runTime, shipNotes); toast(cfg.label + ": Draft created with " + selectedVendors.length + " attachment" + (selectedVendors.length > 1 ? "s" : ""));
            } catch (err) {
              toast("Gmail error: " + err.message, "error");
            } finally { setEmailLoading(false); }
          }} disabled={emailSent || emailLoading || emailBlocked || data.length === 0}>{emailBlocked ? <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#9CA3AF" }}><IconLock /> Create Gmail Draft</span> : emailLoading ? <><Spinner /> Creating...</> : emailSent ? "Draft Created" : <><IconMail /> Create Gmail Draft</>}</Gate>
          </div>
          {emailSent && <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn("danger"), { marginLeft: "auto" })} onClick={clearAll}><IconTrash /> Clear</Gate>}
        </div>
      </div>
    </div>}
  </div>);
}

/* ═══════ PO IMPORT TOOL ═══════ */
function normalizeNdc(ndc) {
  var parts = (ndc || "").replace(/[^0-9-]/g, "").split("-");
  if (parts.length !== 3) return ndc;
  return parts[0].padStart(5, "0") + "-" + parts[1].padStart(4, "0") + "-" + parts[2].padStart(2, "0");
}
function ndcVariants(ndc) {
  var parts = (ndc || "").split("-");
  if (parts.length !== 3) return [ndc];
  var a = parts[0], b = parts[1], c = parts[2], v = {};
  v[ndc] = 1;
  v[a.padStart(5, "0") + "-" + b.padStart(4, "0") + "-" + c.padStart(2, "0")] = 1;
  v[(a.replace(/^0+/, "") || "0") + "-" + (b.replace(/^0+/, "") || "0") + "-" + (c.replace(/^0+/, "") || "0")] = 1;
  return Object.keys(v);
}

/* ═══════ DROP ZONE COMPONENT ═══════ */
function DropZone(props) {
  var onFiles = props.onFiles, accept = props.accept, multiple = props.multiple, label = props.label, sublabel = props.sublabel, icon = props.icon, disabled = props.disabled, color = props.color;
  var _drag = useState(false), dragging = _drag[0], setDragging = _drag[1];
  var inputRef = useRef(null);
  var accent = color || "#14B8A6";

  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    if (disabled) return;
    var files = Array.from(e.dataTransfer.files);
    if (accept) {
      var exts = accept.split(",").map(function(a) { return a.trim().toLowerCase(); });
      files = files.filter(function(f) {
        var name = f.name.toLowerCase();
        var type = f.type.toLowerCase();
        return exts.some(function(ext) { return ext.startsWith(".") ? name.endsWith(ext) : type.match(ext.replace("*", ".*")); });
      });
    }
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
  }
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); if (!disabled) setDragging(true); }
  function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); setDragging(false); }
  function handleClick() { if (!disabled && inputRef.current) inputRef.current.click(); }
  function handleInput(e) { var files = Array.from(e.target.files || []); if (files.length > 0) onFiles(files); e.target.value = ""; }

  var boxStyle = {
    border: "2px dashed " + (dragging ? accent : "#D5D0C8"),
    borderRadius: 12,
    padding: "20px 16px",
    textAlign: "center",
    cursor: disabled ? "default" : "pointer",
    background: dragging ? accent + "08" : "transparent",
    transition: "all 0.15s ease",
    opacity: disabled ? 0.5 : 1,
  };

  var iconSvg = icon === "pdf" ?
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#9CA3AF"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
    : icon === "image" ?
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#9CA3AF"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    : icon === "spreadsheet" ?
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#9CA3AF"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="9" x2="12" y2="21"/></svg>
    :
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#9CA3AF"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;

  return <div style={boxStyle} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={handleClick}>
    <input ref={inputRef} type="file" accept={accept || ""} multiple={!!multiple} onChange={handleInput} style={{ display: "none" }} />
    <div style={{ marginBottom: 6 }}>{iconSvg}</div>
    <div style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{label || "Drop file here"}</div>
    {sublabel && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{sublabel}</div>}
  </div>;
}

/* ═══════ CYCLE COUNTING TOOL ═══════ */
function CycleCountTool(props) {
  var toast = props.toast;
  var cred = props.cred;
  var TOOL_COLOR = props.toolColor || "#14B8A6";
  var isSftp = props.sftp || false;
  var _ndcText = useState(""), ndcText = _ndcText[0], setNdcText = _ndcText[1];
  var _vendorFile = useState(null), vendorFile = _vendorFile[0], setVendorFile = _vendorFile[1];
  var _vendorRows = useState(null), vendorRows = _vendorRows[0], setVendorRows = _vendorRows[1];
  var _csvWarehouses = useState([]), csvWarehouses = _csvWarehouses[0], setCsvWarehouses = _csvWarehouses[1];
  var _csvWhSelected = useState(""), csvWhSelected = _csvWhSelected[0], setCsvWhSelected = _csvWhSelected[1];
  var _csvWhCounts = useState({}), csvWhCounts = _csvWhCounts[0], setCsvWhCounts = _csvWhCounts[1];
  var _stockFile = useState(null), stockFile = _stockFile[0], setStockFile = _stockFile[1];
  var _sftpFile = useState(null), sftpFile = _sftpFile[0], setSftpFile = _sftpFile[1];
  var _sftpRows = useState(null), sftpRows = _sftpRows[0], setSftpRows = _sftpRows[1];
  var _stockRows = useState(null), stockRows = _stockRows[0], setStockRows = _stockRows[1];
  var _stockMeta = useState(null), stockMeta = _stockMeta[0], setStockMeta = _stockMeta[1];
  var _stockLoading = useState(false), stockLoading = _stockLoading[0], setStockLoading = _stockLoading[1];
  var _dohFile = useState(null), dohFile = _dohFile[0], setDohFile = _dohFile[1];
  var _dohRows = useState(null), dohRows = _dohRows[0], setDohRows = _dohRows[1];
  var _dohMeta = useState(null), dohMeta = _dohMeta[0], setDohMeta = _dohMeta[1];
  var _dohLoading = useState(false), dohLoading = _dohLoading[0], setDohLoading = _dohLoading[1];
  var _uomMap = useState(null), uomMap = _uomMap[0], setUomMap = _uomMap[1];
  var _uomMapStatus = useState("idle"), uomMapStatus = _uomMapStatus[0], setUomMapStatus = _uomMapStatus[1];
  var _warehouse = useState(""), warehouse = _warehouse[0], setWarehouse = _warehouse[1];
  var _results = useState([]), results = _results[0], setResults = _results[1];
  var _errors = useState([]), errors = _errors[0], setErrors = _errors[1];
  var _loading = useState(false), loading = _loading[0], setLoading = _loading[1];
  // approvals: { inventoryId: true } — flagged rows the user has approved for CC upload.
  // Reset every time results are regenerated.
  var _approvals = useState({}), approvals = _approvals[0], setApprovals = _approvals[1];

  // Load cached stock items from localStorage on mount
  useEffect(function() {
    try {
      var saved = localStorage.getItem("stock-items-cache");
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed && parsed.rows && parsed.rows.length > 0) {
          setStockRows(parsed.rows);
          setStockMeta({ date: parsed.date || "unknown", count: parsed.rows.length, name: parsed.name || "Stock Items" });
        }
      }
    } catch (e) { /* localStorage unavailable, ignore */ }
  }, []);

  // Upload and cache stock items to localStorage
  function handleStockUpload(file) {
    if (!file) return;
    setStockFile(file);
    setStockLoading(true);
    var formData = new FormData();
    formData.append("file", file);
    fetch("/api/parse-xlsx", { method: "POST", body: formData }).then(function(resp) {
      return resp.json();
    }).then(function(json) {
      if (json.error) { toast("Stock Items parse error: " + json.error, "error"); setStockLoading(false); return; }
      // Only keep the two columns we need to minimize storage
      var trimmed = json.rows.map(function(r) { return { "Inventory ID": r["Inventory ID"] || "", "Sales Unit": r["Sales Unit"] || "", "Base Unit": r["Base Unit"] || "" }; }).filter(function(r) { return r["Inventory ID"]; });
      setStockRows(trimmed);
      var meta = { date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), count: trimmed.length, name: file.name };
      setStockMeta(meta);
      // Save to localStorage
      try {
        localStorage.setItem("stock-items-cache", JSON.stringify({ rows: trimmed, date: meta.date, name: meta.name }));
        toast("Stock Items saved (" + trimmed.length + " items)", "success");
      } catch (e) {
        toast("Stock Items loaded but failed to cache locally", "error");
      }
      setStockLoading(false);
      setStockFile(null);
    }).catch(function(err) {
      toast("Failed to parse Stock Items: " + err.message, "error");
      setStockLoading(false);
    });
  }
  // Load TP-DOH from localStorage on mount, but only if saved date == today.
  // Cache key bumped to v2 in May 2026 when we switched from On Hand → Final FC units
  // for the DRR calculation. Old v1 caches are cleared automatically.
  useEffect(function() {
    try {
      // Drop any legacy v1 cache once, no matter what
      localStorage.removeItem("tpdoh-cache");
      var saved = localStorage.getItem("tpdoh-cache-v2");
      if (saved) {
        var parsed = JSON.parse(saved);
        var today = new Date().toLocaleDateString();
        if (parsed && parsed.savedDate === today && parsed.rows && parsed.rows.length > 0) {
          setDohRows(parsed.rows);
          setDohMeta({ date: parsed.savedDate, count: parsed.rows.length, name: parsed.name || "TP-DOH" });
        } else {
          localStorage.removeItem("tpdoh-cache-v2");
        }
      }
    } catch (e) { /* localStorage unavailable, ignore */ }
  }, []);

  // Fetch UOM conversion map eagerly when cred is available. Forces server-side
  // refresh on first load to bypass the 24h KV cache (which may be stale).
  useEffect(function() {
    if (!cred || !cred.username || !cred.password) return;
    if (uomMap) return;
    var cancelled = false;
    setUomMapStatus("loading");
    fetch("/api/acumatica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "uom-conversions", username: cred.username, password: cred.password, refresh: true }),
    }).then(function(r) { return r.ok ? r.json() : null; }).then(function(json) {
      if (cancelled) return;
      if (!json || !json.data) { setUomMapStatus("failed"); return; }
      // Build nested map: { invId: { TO_UOM: { factor, op, fromUnit, baseUnit } } }
      var map = {};
      json.data.forEach(function(row) {
        var invId = (row.InventoryID || "").trim();
        if (!invId) return;
        var toUnit = (row.ToUnit || "").trim().toUpperCase();
        var fromUnit = (row.FromUnit || "").trim().toUpperCase();
        var baseUnit = (row.BaseUnit || "").trim().toUpperCase();
        var factor = parseFloat(row.ConversionFactor);
        if (!toUnit || isNaN(factor) || factor <= 0) return;
        var op = (row.MultiplyDivide || "Multiply").toLowerCase().indexOf("div") >= 0 ? "Divide" : "Multiply";
        if (!map[invId]) map[invId] = {};
        map[invId][toUnit] = { factor: factor, op: op, fromUnit: fromUnit, baseUnit: baseUnit };
      });
      setUomMap(map);
      setUomMapStatus("loaded:" + Object.keys(map).length);
    }).catch(function() { if (!cancelled) setUomMapStatus("failed"); });
    return function() { cancelled = true; };
  }, [cred]);

  function handleDohUpload(file) {
    if (!file) return;
    setDohFile(file);
    setDohLoading(true);
    var formData = new FormData();
    formData.append("file", file);
    fetch("/api/parse-xlsx", { method: "POST", body: formData }).then(function(resp) {
      return resp.json();
    }).then(function(json) {
      if (json.error) { toast("TP-DOH parse error: " + json.error, "error"); setDohLoading(false); setDohFile(null); return; }
      // Keep only the columns we need — strip Meta data tab values if they leaked in.
      // "Final FC units" header includes the current month (e.g. "Final FC units May 2026"),
      // so we match by prefix instead of exact name so the parser keeps working when the month rolls over.
      var rawRows = json.rows || [];
      var finalFcKey = null;
      if (rawRows.length > 0) {
        var keys = Object.keys(rawRows[0]);
        for (var ki = 0; ki < keys.length; ki++) {
          if (keys[ki].toLowerCase().indexOf("final fc units") === 0) { finalFcKey = keys[ki]; break; }
        }
      }
      var trimmed = rawRows.map(function(r) {
        return {
          productCode: String(r["Product code"] || "").trim(),
          description: String(r["Product description"] || "").trim(),
          locationCode: String(r["Location code"] || "").trim(),
          mainUom: String(r["Main unit of measure"] || "").trim(),
          finalFcUnits: finalFcKey ? (parseFloat(r[finalFcKey]) || 0) : 0,
          daysOnHand: parseFloat(r["Days on hand"]) || 0,
        };
      }).filter(function(r) { return r.productCode; });
      if (trimmed.length === 0) {
        toast("TP-DOH file has no valid rows \u2014 make sure 'Report data' is the first sheet", "error");
        setDohLoading(false); setDohFile(null); return;
      }
      if (!finalFcKey) {
        toast("TP-DOH parsed but no 'Final FC units' column found \u2014 Daily Run Rate will be 0", "error");
      }
      setDohRows(trimmed);
      var today = new Date().toLocaleDateString();
      var meta = { date: today, count: trimmed.length, name: file.name };
      setDohMeta(meta);
      try {
        localStorage.setItem("tpdoh-cache-v2", JSON.stringify({ rows: trimmed, savedDate: today, name: file.name }));
        toast("TP-DOH loaded \u2014 " + trimmed.length + " items (today only)", "success");
      } catch (e) {
        toast("TP-DOH loaded but failed to cache locally", "error");
      }
      setDohLoading(false);
      setDohFile(null);
    }).catch(function(err) {
      toast("Failed to parse TP-DOH: " + err.message, "error");
      setDohLoading(false); setDohFile(null);
    });
  }
  // SFTP BOH report handler
  function handleSftpUpload(file) {
    if (!file) return;
    setSftpFile(file);
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;
      var lines = text.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
      if (lines.length < 2) { toast("SFTP file appears empty", "error"); return; }
      var headers = lines[0].split(",").map(function(h) { return h.trim(); });
      var rows = [];
      for (var i = 1; i < lines.length; i++) {
        var vals = lines[i].split(",");
        var obj = {};
        headers.forEach(function(h, idx) { obj[h] = (vals[idx] || "").trim(); });
        rows.push(obj);
      }
      setSftpRows(rows);
      toast("SFTP BOH loaded: " + rows.length + " items", "success");
    };
    reader.readAsText(file);
  }
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);

  function parseCSV(text) {
    var lines = text.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    if (lines.length === 0) return [];
    var headers = lines[0].split(",").map(function(h) { return h.replace(/"/g, "").trim(); });
    return lines.slice(1).map(function(line) {
      var vals = [];
      var inQuote = false, cur = "";
      for (var i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQuote = !inQuote; }
        else if (line[i] === ',' && !inQuote) { vals.push(cur.trim()); cur = ""; }
        else { cur += line[i]; }
      }
      vals.push(cur.trim());
      var obj = {};
      headers.forEach(function(h, idx) { obj[h] = vals[idx] || ""; });
      return obj;
    });
  }

  function readFileAsText(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(new Error("Failed to read file")); };
      reader.readAsText(file);
    });
  }

  function handleVendorUpload(file) {
    if (!file) return;
    setVendorFile(file);
    readFileAsText(file).then(function(text) {
      var rows = parseCSV(text);
      setVendorRows(rows);
      // Detect unique warehouse names and count rows per warehouse
      var whCounts = {};
      rows.forEach(function(r) { var w = (r.Warehouse || "").trim(); if (w) { whCounts[w] = (whCounts[w] || 0) + 1; } });
      var whList = Object.keys(whCounts).sort();
      setCsvWarehouses(whList);
      setCsvWhCounts(whCounts);
      // Auto-select if only one warehouse
      if (whList.length === 1) setCsvWhSelected(whList[0]);
      else setCsvWhSelected("");
    }).catch(function() { toast("Failed to read CSV", "error"); });
  }

  function readXlsxFile(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        try {
          // Send to server for parsing since CDN may be blocked
          var formData = new FormData();
          formData.append("file", file);
          fetch("/api/parse-xlsx", { method: "POST", body: formData }).then(function(resp) {
            return resp.json();
          }).then(function(json) {
            if (json.error) reject(new Error(json.error));
            else resolve(json.rows);
          }).catch(reject);
        } catch (err) { reject(err); }
      };
      reader.onerror = function() { reject(new Error("Failed to read file")); };
      reader.readAsArrayBuffer(file);
    });
  }

  async function processData() {
    if (!ndcText.trim()) { toast("Paste the NDC list first", "error"); return; }
    if (!vendorRows || vendorRows.length === 0) { toast("Upload the Vendor Inventory CSV", "error"); return; }
    if (!csvWhSelected) { toast("Select a warehouse from the CSV", "error"); return; }
    if (isSftp && (!sftpRows || sftpRows.length === 0)) { toast("Upload the SFTP BOH Report CSV", "error"); return; }
    if (!stockRows || stockRows.length === 0) { toast("Upload the Stock Items XLSX first", "error"); return; }
    if (!warehouse.trim()) { toast("Enter a warehouse code for output", "error"); return; }

    setLoading(true); setResults([]); setErrors([]); setApprovals({});
    try {
      // Parse NDCs from pasted text — extract NDCs with dashes, skip blanks
      var ndcLines = ndcText.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0 && /\d/.test(l); });
      var ndcs = [];
      ndcLines.forEach(function(line) {
        // Try dashed format first (5-4-2 or 4-4-2)
        var match = line.match(/(\d{4,5}-\d{3,4}-\d{1,2})/);
        if (match) { ndcs.push(match[1]); return; }
        // Try 11-digit no-dash format
        var m2 = line.match(/(\d{11})/);
        if (m2) { ndcs.push(m2[1]); return; }
        // Fallback: clean and use whatever digits+dashes are there
        var cleaned = line.replace(/[^\d-]/g, "").trim();
        if (cleaned.length >= 8) ndcs.push(cleaned);
      });

      // Deduplicate NDCs
      var seen = {};
      ndcs = ndcs.filter(function(ndc) { if (seen[ndc]) return false; seen[ndc] = true; return true; });

      // Filter pre-parsed vendor rows by selected CSV warehouse
      var filteredVendor = vendorRows.filter(function(r) {
        return (r.Warehouse || "").trim() === csvWhSelected;
      });

      // Build SKU → vendor row map (SKU = NDC without dashes)
      var skuMap = {};
      filteredVendor.forEach(function(r) {
        var sku = (r.SKU || "").trim();
        if (sku) skuMap[sku] = r;
      });

      // Build SFTP NDC → reported qty map (if SFTP mode)
      var sftpMap = {};
      if (isSftp && sftpRows) {
        var sftpWhMap = { "TP-CA": "CA01", "TP-NY": "NY01", "TP-OH": "OH01", "TRUEPILL_BROOKLYN": "NY01", "TRUEPILL_SEVEN_HILLS": "OH01", "TRUEPILL_HAYWARD": "CA01" };
        var sftpWhCode = sftpWhMap[csvWhSelected] || sftpWhMap[wh] || "";
        if (!sftpWhCode) {
          // Try partial match
          var csvLower = (csvWhSelected || "").toLowerCase();
          if (csvLower.indexOf("brooklyn") >= 0 || csvLower.indexOf("ny") >= 0) sftpWhCode = "NY01";
          else if (csvLower.indexOf("seven") >= 0 || csvLower.indexOf("oh") >= 0) sftpWhCode = "OH01";
          else if (csvLower.indexOf("hayward") >= 0 || csvLower.indexOf("ca") >= 0) sftpWhCode = "CA01";
        }
        sftpRows.forEach(function(r) {
          // Filter by warehouse if we have a mapping
          if (sftpWhCode && (r["Warehouse Code"] || "").trim() !== sftpWhCode) return;
          var ndc = (r["NDC_SKU"] || "").replace(/-/g, "").trim();
          if (ndc) {
            var initialQty = parseFloat(r["Initial Sales Quantity On Hand"]) || 0;
            var holdQty = parseFloat(r["Sales Quantity On Hold"]) || 0;
            sftpMap[ndc] = Math.round((initialQty - holdQty) * 10) / 10;
          }
        });
      }

      // Build Inventory ID → Sales Unit + Base Unit maps from cached stock items
      var salesUnitMap = {};
      var baseUnitMap = {};
      stockRows.forEach(function(r) {
        var invId = String(r["Inventory ID"] || "").trim();
        var salesUnit = String(r["Sales Unit"] || "").trim();
        var baseUnit = String(r["Base Unit"] || "").trim();
        if (invId) {
          salesUnitMap[invId] = salesUnit;
          baseUnitMap[invId] = baseUnit;
        }
      });

      // Process each NDC
      var output = [];
      var errs = [];
      var wh = warehouse.trim();

      ndcs.forEach(function(ndc) {
        var ndcClean = ndc.replace(/-/g, "");
        var vendorRow = skuMap[ndcClean];

        if (!vendorRow) {
          errs.push("NDC " + ndc + " (" + ndcClean + ") not found in Vendor Inventory for " + csvWhSelected);
          return;
        }

        var invId = (vendorRow["Manufacturer Number"] || "").trim();
        var reportedQty = Math.round((isSftp && sftpMap.hasOwnProperty(ndcClean) ? sftpMap[ndcClean] : (parseFloat(vendorRow["Reported Qty"]) || 0)) * 10) / 10;
        var stockQty = Math.round((parseFloat(vendorRow["Stock Qty"]) || 0) * 10) / 10;
        var quantity = Math.round((reportedQty - stockQty) * 10) / 10;
        var pkgSize = parseFloat(vendorRow["Package Size"]) || 0;

        // Location: GEN- or UNV- items use NDC without dashes, others use warehouse code
        var location = (invId.startsWith("GEN-") || invId.startsWith("UNV-")) ? ndcClean : wh;

        // UOM from stock items
        var uom = salesUnitMap[invId] || "";
        if (!uom) {
          errs.push("Inventory ID " + invId + " (NDC " + ndc + ") not found in Stock Items for UOM");
        }

        output.push({
          inventoryId: invId,
          warehouse: wh,
          location: location,
          quantity: quantity,
          uom: uom,
          ndc: ndc,
          ndcClean: ndcClean,
          reportedQty: reportedQty,
          stockQty: stockQty,
          pkgSize: pkgSize,
        });
      });

      // If TP-DOH file is loaded, enrich each result with Daily Run Rate.
      // Recipe (changed May 2026: Final FC units replaces On Hand as the DRR numerator):
      //   1. drrInBase = TP-DOH Final FC units ÷ Days on Hand (in TP-DOH's Main Unit of Measure)
      //   2. Get TP-DOH's Main UOM for the item (from the TP-DOH row)
      //   3. Get Sales Unit for the item (from Stock Items)
      //   4. In Stock Item UOM Conversions GI, find the row where
      //      InventoryID matches AND FromUnit == TP-DOH Main UOM AND ToUnit == Sales Unit
      //   5. Multiply DRR by that row's Conversion Factor (factor is 1 for same-unit rows
      //      like PACK→PACK, which still applies as a no-op)
      // Days of Supply = Adjustment ÷ Converted DRR
      if (dohRows && dohRows.length > 0) {
        var dohMap = {};
        dohRows.forEach(function(r) {
          if (r.productCode && r.locationCode) {
            dohMap[r.productCode + "|" + r.locationCode] = r;
          }
        });
        output.forEach(function(row) {
          var dohRow = dohMap[row.inventoryId + "|" + wh];
          if (!dohRow) { row.dailyRunRate = null; row.convertedDailyRunRate = null; return; }
          row.dohDescription = dohRow.description;
          row.dohFinalFcUnits = dohRow.finalFcUnits;
          row.dohDaysOnHand = dohRow.daysOnHand;
          if (dohRow.daysOnHand <= 0) { row.dailyRunRate = null; row.convertedDailyRunRate = null; return; }

          // Step 1: DRR in TP-DOH's native unit
          var drrInBase = dohRow.finalFcUnits / dohRow.daysOnHand;

          // Step 2 & 3: get the FROM unit (TP-DOH Main UOM) and TO unit (Stock Items Sales Unit)
          var mainUom = (dohRow.mainUom || "").toUpperCase();
          var salesUnit = (row.uom || "").toUpperCase();

          // Step 4: find GI row matching FromUnit=mainUom AND ToUnit=salesUnit
          var drrInSales = drrInBase;
          var convSource = "none";
          var conv = (salesUnit && uomMap && uomMap[row.inventoryId]) ? uomMap[row.inventoryId][salesUnit] : null;
          if (conv && conv.factor) {
            // Match FromUnit to TP-DOH's Main UOM when available; if Main UOM is missing
            // from the TP-DOH file (older cache), trust the GI's FromUnit (which is the
            // base unit by Acumatica convention).
            if (!mainUom || conv.fromUnit === mainUom) {
              // Step 5: multiply DRR by the GI's Conversion Factor (1 for same-unit, N otherwise)
              drrInSales = drrInBase * conv.factor;
              convSource = mainUom ? "gi" : "gi-no-mainUom";
            } else {
              convSource = "gi-uom-mismatch:" + conv.fromUnit + "≠" + mainUom;
            }
          } else if (salesUnit && row.pkgSize > 0) {
            // Fallback: Package Size from vendor CSV when GI has no matching row.
            // Only apply if Stock Items confirms Base ≠ Sales.
            var baseUnitFromStock = (baseUnitMap[row.inventoryId] || "").toUpperCase();
            if (baseUnitFromStock && baseUnitFromStock !== salesUnit) {
              drrInSales = drrInBase * row.pkgSize;
              convSource = "pkg";
            }
          }

          row.dailyRunRate = Math.round(drrInBase * 100) / 100;
          row.convertedDailyRunRate = Math.round(drrInSales * 100) / 100;
          row.drrConvSource = convSource;
        });

        // Compute Days of Supply change + flag status for each row.
        // Rules:
        //   - DoS = Adjustment / Converted DRR (positive = supply added, negative = supply removed)
        //   - Flag when |DoS| > 7 days
        //   - Also flag when Adjustment is non-zero but DRR is missing/zero (impact unknown — needs approval)
        //   - Adjustment of 0 is never flagged (no supply change either way)
        output.forEach(function(row) {
          var adj = row.quantity;
          var crr = row.convertedDailyRunRate;
          if (adj === 0) {
            row.daysOfSupply = 0;
            row.isFlagged = false;
            row.flagReason = "";
          } else if (crr == null || crr <= 0) {
            row.daysOfSupply = null;
            row.isFlagged = true;
            row.flagReason = "no DRR";
          } else {
            row.daysOfSupply = Math.round((adj / crr) * 10) / 10;
            if (Math.abs(row.daysOfSupply) > 7) {
              row.isFlagged = true;
              row.flagReason = "|DoS| > 7";
            } else {
              row.isFlagged = false;
              row.flagReason = "";
            }
          }
        });
      } else {
        // No DOH file → no flags at all
        output.forEach(function(row) {
          row.daysOfSupply = null;
          row.isFlagged = false;
          row.flagReason = "";
        });
      }

      setResults(output);
      setErrors(errs);
      toast("Processed " + output.length + " items" + (errs.length > 0 ? ", " + errs.length + " warnings" : ""));
    } catch (err) {
      toast("Error: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // CC upload routing:
  //   - If no DOH file: include everything (today's behavior, no flag UI shown)
  //   - If DOH file loaded: include unflagged rows + flagged rows that have been approved
  function getUploadRows() {
    var hasDoh = dohRows && dohRows.length > 0;
    if (!hasDoh) return results;
    return results.filter(function(r) {
      if (!r.isFlagged) return true;
      return !!approvals[r.inventoryId];
    });
  }

  // CC check routing: flagged rows that have NOT been approved (only meaningful when DOH is loaded)
  function getCheckRows() {
    return results.filter(function(r) { return r.isFlagged && !approvals[r.inventoryId]; });
  }

  function downloadCSV() {
    var rows = getUploadRows();
    var header = "Inventory ID,Warehouse,Location,Quantity,UOM\r\n";
    var lines = rows.map(function(r) {
      return [r.inventoryId, r.warehouse, r.location, r.quantity, r.uom]
        .map(function(v) { return "\"" + String(v == null ? "" : v).replace(/"/g, '""') + "\""; }).join(",");
    });
    var csv = header + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "CC_" + warehouse.trim() + "_" + new Date().toISOString().slice(5, 10).replace("-", "_") + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadDrrCSV() {
    var rows = getCheckRows();
    var header = "Inventory ID,NDC,Location Code,Description,Fuze's Counts,Our Counts,Adjustment,Daily Run Rate,Converted Daily Run Rate,Days of Supply\r\n";
    var lines = rows.map(function(r) {
      var daysOfSupply = r.daysOfSupply != null ? r.daysOfSupply : "";
      return [
        r.inventoryId,
        r.ndc,
        r.warehouse,
        r.dohDescription || "",
        r.reportedQty,
        r.stockQty,
        r.quantity,
        r.dailyRunRate != null ? r.dailyRunRate : "",
        r.convertedDailyRunRate != null ? r.convertedDailyRunRate : "",
        daysOfSupply,
      ].map(function(v) { return "\"" + String(v == null ? "" : v).replace(/"/g, '""') + "\""; }).join(",");
    });
    var csv = header + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "CC_Check_" + warehouse.trim() + "_" + new Date().toISOString().slice(5, 10).replace("-", "_") + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return <div>
    <p style={{ color: "#6B7280", fontSize: 14, marginBottom: 20 }}>Generate cycle count adjustment CSVs from Pharm Admin data and Stock Items.</p>

    <div style={S.card}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 14, color: "#374151", fontWeight: 600, marginBottom: 8 }}>1. Paste NDC List</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Copy the NDC column from your Google Sheet and paste below</div>
          <textarea value={ndcText} onChange={function(e) { setNdcText(e.target.value); }} placeholder={"68462-0128-01\n68462-0129-01\n43547-0336-10\n..."} rows={8} style={Object.assign({}, S.inp, { resize: "vertical", fontFamily: "monospace", fontSize: 12 })} />
          {ndcText.trim() && (function() { var lines = ndcText.trim().split("\n").filter(function(l) { return l.trim(); }); var u = {}; lines.forEach(function(l) { u[l.trim()] = 1; }); var total = lines.length, unique = Object.keys(u).length; return <p style={{ color: "#059669", fontSize: 12, marginTop: 6 }}>{"\u2713"} {unique} NDCs pasted{total > unique ? " (" + (total - unique) + " duplicate" + (total - unique > 1 ? "s" : "") + " removed)" : ""}</p>; })()}
        </div>
        <div>
          <div style={{ fontSize: 14, color: "#374151", fontWeight: 600, marginBottom: 8 }}>2. Warehouse Code</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Type the warehouse code for the output (e.g. TP-NY, TP-OH)</div>
          <input value={warehouse} onChange={function(e) { setWarehouse(e.target.value); }} placeholder="TP-NY" style={Object.assign({}, S.inp, { maxWidth: 200 })} />

          <div style={{ fontSize: 14, color: "#374151", fontWeight: 600, marginBottom: 8, marginTop: 20 }}>3. Vendor Inventory CSV</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Export from Pharm Admin (contains SKU, Manufacturer Number, Reported Qty, Stock Qty)</div>
          {vendorFile ? <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
              <span style={{ color: "#059669", fontSize: 13 }}>{"\u2713"} {vendorFile.name} — {vendorRows ? vendorRows.length.toLocaleString() + " rows" : "parsing..."}</span>
              <button onClick={function() { setVendorFile(null); setVendorRows(null); setCsvWarehouses([]); setCsvWhSelected(""); setCsvWhCounts({}); }} style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>{"\u00D7"}</button>
            </div>
          </div> : <DropZone accept=".csv" label="Vendor Inventory CSV" sublabel="Drop CSV or click to browse" icon="spreadsheet" color={TOOL_COLOR} onFiles={function(files) { handleVendorUpload(files[0]); }} />}
          {csvWarehouses.length > 1 && <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Select warehouse from CSV:</div>
            <select value={csvWhSelected} onChange={function(e) { setCsvWhSelected(e.target.value); }} style={Object.assign({}, S.inp, { maxWidth: 280, cursor: "pointer" })}>
              <option value="">— Select —</option>
              {csvWarehouses.map(function(w) { return <option key={w} value={w}>{w} ({(csvWhCounts[w] || 0).toLocaleString()} rows)</option>; })}
            </select>
            {csvWhSelected && <p style={{ color: TOOL_COLOR, fontSize: 12, marginTop: 4 }}>Filtering to {(csvWhCounts[csvWhSelected] || 0).toLocaleString()} rows from {csvWhSelected}</p>}
          </div>}
          {csvWarehouses.length === 1 && <p style={{ color: TOOL_COLOR, fontSize: 12, marginTop: 4 }}>Warehouse: {csvWhSelected} ({(csvWhCounts[csvWhSelected] || 0).toLocaleString()} rows)</p>}

          {isSftp && <div>
            <div style={{ fontSize: 14, color: "#374151", fontWeight: 600, marginBottom: 8, marginTop: 20 }}>4. SFTP BOH Report CSV</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Upload the Fuze SFTP BOH report. Reported Qty = Initial Sales Qty On Hand − Sales Qty On Hold</div>
            {sftpFile && sftpRows ? <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
                <span style={{ color: "#059669", fontSize: 13 }}>{"\u2713"} {sftpFile.name} — {sftpRows.length.toLocaleString()} items</span>
                <button onClick={function() { setSftpFile(null); setSftpRows(null); }} style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>{"\u00D7"}</button>
              </div>
            </div> : <DropZone accept=".csv" label="SFTP BOH Report" sublabel="Drop CSV or click to browse" icon="spreadsheet" color={TOOL_COLOR} onFiles={function(files) { handleSftpUpload(files[0]); }} />}
          </div>}

          <div style={{ fontSize: 14, color: "#374151", fontWeight: 600, marginBottom: 8, marginTop: 20, display: "flex", alignItems: "center", gap: 6 }}>{isSftp ? "5" : "4"}. TP-DOH Netstock File <span style={{ fontSize: 11, fontWeight: 400, color: "#9CA3AF" }}>(optional, resets daily)</span></div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Provides Daily Run Rate (Final FC units ÷ Days on Hand) for a second export. Reupload each day.</div>
          {dohRows && dohMeta ? <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(20,184,166,0.08)", border: "1px solid rgba(20,184,166,0.25)", borderRadius: 10 }}>
              <span style={{ color: TOOL_COLOR, fontSize: 13 }}>{"\u2713"} {dohMeta.name} — {dohMeta.count.toLocaleString()} items (loaded {dohMeta.date})</span>
              <button onClick={function() { setDohRows(null); setDohMeta(null); try { localStorage.removeItem("tpdoh-cache-v2"); } catch (e) {} }} style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px", marginLeft: "auto" }}>{"\u00D7"}</button>
            </div>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6, paddingLeft: 4 }}>
              UOM conversions: {
                uomMapStatus === "idle" ? "not loaded (set Acumatica creds)" :
                uomMapStatus === "loading" ? "loading..." :
                uomMapStatus === "failed" ? "failed to load" :
                uomMapStatus.indexOf("loaded:") === 0 ? (uomMapStatus.split(":")[1] + " items from Acumatica GI") :
                uomMapStatus
              }
            </div>
            <label style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: TOOL_COLOR, cursor: "pointer", textDecoration: "underline" }}>
              {dohLoading ? "Uploading..." : "Replace with new file"}
              <input type="file" accept=".xlsx,.xls" onChange={function(e) { if (e.target.files[0]) handleDohUpload(e.target.files[0]); }} style={{ display: "none" }} disabled={dohLoading} />
            </label>
          </div> : <div>
            <DropZone accept=".xlsx,.xls" label="TP-DOH Netstock File" sublabel="Drop XLSX or click to browse" icon="spreadsheet" color={TOOL_COLOR} disabled={dohLoading} onFiles={function(files) { handleDohUpload(files[0]); }} />
            {dohLoading && <p style={{ color: TOOL_COLOR, fontSize: 12, marginTop: 6 }}>Parsing...</p>}
          </div>}

          <div style={{ fontSize: 14, color: "#374151", fontWeight: 600, marginBottom: 8, marginTop: 20, display: "flex", alignItems: "center", gap: 6 }}>{isSftp ? "6" : "5"}. Stock Items XLSX <InfoTip text="Before uploading, make sure to delete all tabs except the one labeled 'Data' in the Excel file." /></div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Contains Inventory ID and Sales Unit for UOM lookup</div>
          {stockRows && stockMeta ? <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
              <span style={{ color: "#059669", fontSize: 13 }}>{"\u2713"} {stockMeta.name} — {stockMeta.count.toLocaleString()} items (saved {stockMeta.date})</span>
            </div>
            <label style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: TOOL_COLOR, cursor: "pointer", textDecoration: "underline" }}>
              {stockLoading ? "Uploading..." : "Replace with new file"}
              <input type="file" accept=".xlsx,.xls" onChange={function(e) { if (e.target.files[0]) handleStockUpload(e.target.files[0]); }} style={{ display: "none" }} disabled={stockLoading} />
            </label>
          </div> : <div>
            <DropZone accept=".xlsx,.xls" label="Stock Items XLSX" sublabel="Drop file or click to browse" icon="spreadsheet" color={TOOL_COLOR} disabled={stockLoading} onFiles={function(files) { handleStockUpload(files[0]); }} />
            {stockLoading && <p style={{ color: TOOL_COLOR, fontSize: 12, marginTop: 6 }}>Parsing and saving...</p>}
          </div>}
        </div>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={processData} disabled={loading} style={Object.assign({}, S.btn(), { padding: "10px 20px", opacity: loading ? 0.5 : 1 })}>
          {loading ? "Processing..." : "Generate Cycle Count"}
        </button>
        {results.length > 0 && <button onClick={downloadCSV} style={Object.assign({}, S.btn("ghost"), { padding: "10px 16px" })}><IconDL /> CC upload{dohRows && dohRows.length > 0 ? " (" + getUploadRows().length + ")" : ""}</button>}
        {results.length > 0 && dohRows && dohRows.length > 0 && getCheckRows().length > 0 && <button onClick={downloadDrrCSV} style={Object.assign({}, S.btn("ghost"), { padding: "10px 16px" })}><IconDL /> CC check ({getCheckRows().length})</button>}
        {results.length > 0 && <span style={{ fontSize: 12, color: "#6B7280" }}>{results.length} items</span>}
        {(ndcText.trim() || vendorFile || results.length > 0) && <button onClick={function() { setNdcText(""); setVendorFile(null); setVendorRows(null); setCsvWarehouses([]); setCsvWhSelected(""); setCsvWhCounts({}); setWarehouse(""); setResults([]); setErrors([]); setSftpFile(null); setSftpRows(null); setApprovals({}); }} style={Object.assign({}, S.btn("ghost"), { padding: "10px 16px", marginLeft: "auto" })}><IconTrash /> Clear</button>}
      </div>
    </div>

    {errors.length > 0 && <div style={{ marginBottom: 16 }}>
      {errors.map(function(err, i) {
        return <div key={i} style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 10, padding: "8px 14px", marginBottom: 6, fontSize: 13, color: "#D97706" }}>{"\u26A0"} {err}</div>;
      })}
    </div>}

    {results.length > 0 && (function() {
      var hasDoh = dohRows && dohRows.length > 0;
      // Sort: flagged first (descending by |DoS|, with no-DRR flagged rows at the very top),
      // then unflagged in original order.
      var sortedResults = results.slice();
      if (hasDoh) {
        sortedResults.sort(function(a, b) {
          if (a.isFlagged !== b.isFlagged) return a.isFlagged ? -1 : 1;
          if (a.isFlagged) {
            // No-DRR flagged rows first (most uncertain)
            var aNoDrr = a.daysOfSupply == null;
            var bNoDrr = b.daysOfSupply == null;
            if (aNoDrr !== bNoDrr) return aNoDrr ? -1 : 1;
            return Math.abs(b.daysOfSupply || 0) - Math.abs(a.daysOfSupply || 0);
          }
          return 0;
        });
      }
      var flaggedCount = sortedResults.filter(function(r) { return r.isFlagged; }).length;
      function toggleApproval(invId) {
        var u = Object.assign({}, approvals);
        if (u[invId]) { delete u[invId]; } else { u[invId] = true; }
        setApprovals(u);
      }
      // Header checkbox: if currently all flagged rows are approved → unapprove all;
      // otherwise (none or some approved) → approve all. Mirrors standard inbox UX.
      var flaggedRows = sortedResults.filter(function(r) { return r.isFlagged; });
      var approvedFlaggedCount = flaggedRows.filter(function(r) { return !!approvals[r.inventoryId]; }).length;
      var allApproved = flaggedRows.length > 0 && approvedFlaggedCount === flaggedRows.length;
      var someApproved = approvedFlaggedCount > 0 && !allApproved;
      function toggleApproveAll() {
        var u = Object.assign({}, approvals);
        if (allApproved) {
          // Currently checked → uncheck → clear all flagged approvals
          flaggedRows.forEach(function(r) { delete u[r.inventoryId]; });
        } else {
          // Unchecked or mixed → check → approve all flagged
          flaggedRows.forEach(function(r) { u[r.inventoryId] = true; });
        }
        setApprovals(u);
      }
      return <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 300px)" })}>
        {hasDoh && flaggedCount > 0 && <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "rgba(220,38,38,0.04)", borderBottom: "1px solid rgba(220,38,38,0.15)", fontSize: 12, color: "#6B7280" }}>
          <span style={{ color: "#DC2626", fontWeight: 600 }}>{"\u26A0"} {flaggedCount} flagged ({"|"}DoS{"|"} {">"} 7 days or unknown DRR)</span>
          <span style={{ color: "#9CA3AF" }}>{"\u00B7"}</span>
          <span>Check to approve for CC upload; leave unchecked to route to CC check.</span>
        </div>}
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead><tr>
            {hasDoh && <th style={Object.assign({}, S.th, { width: 60, textAlign: "center" })}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span>Approve</span>
                {flaggedRows.length > 0 && <input type="checkbox" checked={allApproved} ref={function(el) { if (el) el.indeterminate = someApproved; }} onChange={toggleApproveAll} title={allApproved ? "Uncheck all" : "Approve all flagged"} style={{ cursor: "pointer", width: 14, height: 14 }} />}
              </div>
            </th>}
            {["Inventory ID", "Warehouse", "Location", "UOM", "NDC", "Reported Qty", "Stock Qty", "Adjustment Quantity"].map(function(h) { return <th key={h} style={S.th}>{h}</th>; })}
            {hasDoh && <th style={S.th}>DRR</th>}
            {hasDoh && <th style={S.th}>Days of Supply</th>}
          </tr></thead>
          <tbody>{sortedResults.map(function(r, i) {
            var approved = !!approvals[r.inventoryId];
            var rowBg;
            if (r.isFlagged && !approved) rowBg = "rgba(220,38,38,0.06)";
            else if (r.isFlagged && approved) rowBg = "rgba(5,150,105,0.05)";
            else if (r.quantity < 0) rowBg = "rgba(220,38,38,0.04)";
            else rowBg = "transparent";
            // Add a subtle divider after the last flagged row
            var isLastFlagged = hasDoh && r.isFlagged && (i + 1 < sortedResults.length) && !sortedResults[i + 1].isFlagged;
            var borderBottom = isLastFlagged ? "2px solid rgba(220,38,38,0.2)" : undefined;
            var dosDisplay = r.daysOfSupply == null ? "—" : (r.daysOfSupply > 0 ? "+" : "") + r.daysOfSupply.toFixed(1);
            var dosColor = r.daysOfSupply == null ? "#DC2626" : (Math.abs(r.daysOfSupply) > 7 ? "#DC2626" : "#374151");
            return <tr key={i} style={{ background: rowBg, borderBottom: borderBottom }}>
              {hasDoh && <td style={Object.assign({}, S.td, { textAlign: "center" })}>{r.isFlagged ? <input type="checkbox" checked={approved} onChange={function() { toggleApproval(r.inventoryId); }} style={{ cursor: "pointer", width: 16, height: 16 }} /> : <span style={{ color: "#D1D5DB" }}>{"\u2014"}</span>}</td>}
              <td style={Object.assign({}, S.td, { color: r.inventoryId.startsWith("GEN-") ? "#059669" : r.inventoryId.startsWith("UNV-") ? "#2563EB" : "#374151" })}>{r.inventoryId}</td>
              <td style={S.td}>{r.warehouse}</td>
              <td style={S.td}>{r.location}</td>
              <td style={S.td}>{r.uom}</td>
              <td style={Object.assign({}, S.td, { color: "#6B7280" })}>{r.ndc}</td>
              <td style={Object.assign({}, S.td, { color: "#6B7280" })}>{r.reportedQty.toFixed(1)}</td>
              <td style={Object.assign({}, S.td, { color: "#6B7280" })}>{r.stockQty.toFixed(1)}</td>
              <td style={Object.assign({}, S.td, { color: r.quantity < 0 ? "#DC2626" : "#374151" })}>{r.quantity.toFixed(1)}</td>
              {hasDoh && <td style={Object.assign({}, S.td, { color: "#6B7280", fontSize: 12 })}>{r.convertedDailyRunRate != null ? r.convertedDailyRunRate : "—"}</td>}
              {hasDoh && <td style={Object.assign({}, S.td, { color: dosColor, fontWeight: r.isFlagged ? 600 : 400, fontSize: 12 })}>{dosDisplay}{r.flagReason === "no DRR" ? " (no DRR)" : ""}</td>}
            </tr>;
          })}</tbody>
        </table>
      </div>;
    })()}
  </div>;
}

function POImportTool(props) {
  var toast = props.toast, cred = props.cred, ok = props.ok, lp = props.lp;
  var TOOL_COLOR = "#06B6D4";

  var _vendor = useState("other"), vendor = _vendor[0], setVendor = _vendor[1];
  var _pdfs = useState([]), pdfs = _pdfs[0], setPdfs = _pdfs[1];
  var _mckPaste = useState(""), mckPaste = _mckPaste[0], setMckPaste = _mckPaste[1];
  var _mckParsed = useState(null), mckParsed = _mckParsed[0], setMckParsed = _mckParsed[1];
  var _mckFile = useState(null), mckFile = _mckFile[0], setMckFile = _mckFile[1];
  var _mckFileLoading = useState(false), mckFileLoading = _mckFileLoading[0], setMckFileLoading = _mckFileLoading[1];
  var _mckPortalPrices = useState({}), mckPortalPrices = _mckPortalPrices[0], setMckPortalPrices = _mckPortalPrices[1];
  var _loading = useState(false), loading = _loading[0], setLoading = _loading[1];
  var _results = useState([]), results = _results[0], setResults = _results[1];
  var _screenshotQtys = useState({}), screenshotQtys = _screenshotQtys[0], setScreenshotQtys = _screenshotQtys[1];
  var _editedPrices = useState({}), editedPrices = _editedPrices[0], setEditedPrices = _editedPrices[1];
  var _mckWarnings = useState([]), mckWarnings = _mckWarnings[0], setMckWarnings = _mckWarnings[1];
  var _error = useState(null), error = _error[0], setError = _error[1];
  var _statedAmts = useState({}), statedAmounts = _statedAmts[0], setStatedAmounts = _statedAmts[1];
  var _ndcMap = useState(null), ndcMap = _ndcMap[0], setNdcMap = _ndcMap[1];
  var _ndcLoading = useState(false), ndcLoading = _ndcLoading[0], setNdcLoading = _ndcLoading[1];
  var _activeFileTab = useState(null), activeFileTab = _activeFileTab[0], setActiveFileTab = _activeFileTab[1];
  var _flagThreshold = useState(40), flagThreshold = _flagThreshold[0], setFlagThreshold = _flagThreshold[1];
  // Acumatica auto-create state
  var _acuCreateLoading = useState(false), acuCreateLoading = _acuCreateLoading[0], setAcuCreateLoading = _acuCreateLoading[1];
  var _acuCreateConfirm = useState(null), acuCreateConfirm = _acuCreateConfirm[0], setAcuCreateConfirm = _acuCreateConfirm[1];
  var _acuCreateResult = useState(null), acuCreateResult = _acuCreateResult[0], setAcuCreateResult = _acuCreateResult[1];
  useEffect(function() {
    var mt = true;
    kvGet("po-translator-flag-threshold").then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (mt && d && d.data != null) {
        var n = parseFloat(d.data);
        if (!isNaN(n) && n > 0) setFlagThreshold(n);
      }
    }).catch(function() {});
    return function() { mt = false; };
  }, []);
  function updateFlagThreshold(v) {
    var n = parseFloat(v);
    if (isNaN(n) || n <= 0) return;
    setFlagThreshold(n);
    kvPost("po-translator-flag-threshold", n).catch(function() {});
  }
  // Persist results separately per vendor type so switching doesn't lose data
  var otherCache = useRef({ pdfs: [], results: [], editedPrices: {}, screenshotQtys: {}, error: null });
  var mckCache = useRef({ pdfs: [], results: [], mckPaste: "", mckParsed: null, mckFile: null, mckPortalPrices: {}, editedPrices: {}, screenshotQtys: {}, mckWarnings: [], error: null });
  var ggmCache = useRef({ pdfs: [], results: [], editedPrices: {}, screenshotQtys: {}, error: null });

  function switchVendor(newVendor) {
    if (newVendor === vendor) return;
    // Save current state to cache
    if (vendor === "other") {
      otherCache.current = { pdfs: pdfs, results: results, editedPrices: editedPrices, screenshotQtys: screenshotQtys, error: error };
    } else if (vendor === "mckesson") {
      mckCache.current = { pdfs: pdfs, results: results, mckPaste: mckPaste, mckParsed: mckParsed, mckFile: mckFile, mckPortalPrices: mckPortalPrices, editedPrices: editedPrices, screenshotQtys: screenshotQtys, mckWarnings: mckWarnings, error: error };
    } else if (vendor === "ggm-crossovers") {
      ggmCache.current = { pdfs: pdfs, results: results, editedPrices: editedPrices, screenshotQtys: screenshotQtys, error: error };
    }
    // Restore from cache
    if (newVendor === "other") {
      var c = otherCache.current;
      setPdfs(c.pdfs); setResults(c.results); setEditedPrices(c.editedPrices); setScreenshotQtys(c.screenshotQtys); setError(c.error);
      setMckWarnings([]);
    } else if (newVendor === "mckesson") {
      var m = mckCache.current;
      setPdfs(m.pdfs); setResults(m.results); setMckPaste(m.mckPaste); setMckParsed(m.mckParsed); setMckFile(m.mckFile); setMckPortalPrices(m.mckPortalPrices); setEditedPrices(m.editedPrices); setScreenshotQtys(m.screenshotQtys); setMckWarnings(m.mckWarnings); setError(m.error);
    } else if (newVendor === "ggm-crossovers") {
      var g = ggmCache.current;
      setPdfs(g.pdfs); setResults(g.results); setEditedPrices(g.editedPrices); setScreenshotQtys(g.screenshotQtys); setError(g.error);
      setMckWarnings([]);
    }
    setVendor(newVendor);
  }

  function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      var r = new FileReader();
      r.onload = function() { resolve(r.result.split(",")[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function handlePdfChange(files) {
    var converted = await Promise.all(files.map(async function(f) { return { data: await fileToBase64(f), name: f.name }; }));
    setPdfs(converted);
  }

  function normalizeNdcForCompare(ndc) {
    return (ndc || "").replace(/-/g, "").replace(/\s/g, "");
  }

  // Parse McKesson export CSV
  // Key columns: FilledNdcUpc (NDC), OrderQty (quantity), Est. Net Price (unit cost)
  // First row may be metadata ("Export Date = ..."), headers on row 2
  function parseMckCsv(text) {
    var lines = text.split("\n").map(function(l) { return l.replace(/\r/g, "").trim(); }).filter(function(l) { return l.length > 0; });
    if (lines.length < 2) return { items: [], prices: {} };

    // Detect if first line is metadata (not headers)
    var headerIdx = 0;
    if (lines[0].indexOf("Export Date") >= 0 || lines[0].indexOf("Number of records") >= 0) headerIdx = 1;

    var headers = [];
    var inQ = false, cur = "";
    for (var ci = 0; ci < lines[headerIdx].length; ci++) {
      var ch = lines[headerIdx][ci];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { headers.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    headers.push(cur.trim());

    var items = [];
    var prices = {};

    for (var li = headerIdx + 1; li < lines.length; li++) {
      var vals = [];
      var inQuote = false, cell = "";
      for (var vi = 0; vi < lines[li].length; vi++) {
        var c = lines[li][vi];
        if (c === '"') { inQuote = !inQuote; }
        else if (c === "," && !inQuote) { vals.push(cell.trim()); cell = ""; }
        else { cell += c; }
      }
      vals.push(cell.trim());

      var row = {};
      headers.forEach(function(h, idx) { row[h] = vals[idx] || ""; });

      // Find NDC — pad to 11 digits
      var rawNdc = (row["FilledNdcUpc"] || row["NDC"] || "").replace(/[^0-9]/g, "");
      if (rawNdc.length < 8) continue;
      while (rawNdc.length < 11) rawNdc = "0" + rawNdc;

      var qty = parseInt(row["OrderQty"]) || null;
      var estNet = parseFloat((row["Est. Net Price"] || "").replace(/[$,]/g, ""));

      items.push({ ndc: rawNdc, description: row["SellDescription"] || row["FirstDatabankDescription"] || "", qty: qty, mckItemNum: row["FilledItemNumber"] || "" });
      if (!isNaN(estNet) && estNet > 0) prices[rawNdc] = estNet;
    }

    return { items: items, prices: prices };
  }

  async function handleMckFileUpload(files) {
    var file = files[0];
    if (!file) return;
    setMckFile(file);
    setMckFileLoading(true);
    try {
      var text = await new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(reader.result); };
        reader.onerror = function() { reject(new Error("Failed to read file")); };
        reader.readAsText(file);
      });
      var result = parseMckCsv(text);
      if (result.items.length === 0) throw new Error("No items found in CSV. Check that FilledNdcUpc column exists.");
      setMckParsed(result.items);
      setMckPortalPrices(result.prices);
      var priceCount = Object.keys(result.prices).length;
      toast("Loaded " + result.items.length + " items with " + priceCount + " prices from " + file.name);
    } catch (err) {
      toast("McKesson CSV error: " + err.message, "error");
      setMckFile(null);
    } finally {
      setMckFileLoading(false);
    }
  }

  // Extract NDCs from text (manual paste)
  function extractNdcsFromText(text) {
    var ndcs = [], seen = {};
    var re11 = /\b(\d{11})\b/g, m;
    while ((m = re11.exec(text)) !== null) { if (!seen[m[1]]) { seen[m[1]] = true; ndcs.push(m[1]); } }
    var reDash = /\b(\d{4,5}-\d{3,4}-\d{1,2})\b/g;
    while ((m = reDash.exec(text)) !== null) { var n = m[1].replace(/-/g, ""); if (!seen[n]) { seen[n] = true; ndcs.push(n); } }
    return ndcs;
  }

  function handleMckManualPaste(e) {
    var text = e.target.value;
    setMckPaste(text);
    var manualNdcs = extractNdcsFromText(text);
    // Merge with file NDCs
    var fileItems = (mckFile && mckParsed) ? mckParsed.slice() : [];
    var allNdcs = {};
    fileItems.forEach(function(item) { allNdcs[item.ndc] = item; });
    manualNdcs.forEach(function(ndc) {
      if (!allNdcs[ndc]) allNdcs[ndc] = { ndc: ndc, description: "", qty: null, mckItemNum: "" };
    });
    var combined = Object.values(allNdcs);
    if (combined.length > 0) {
      setMckParsed(combined);
    } else {
      setMckParsed(null);
    }
  }


  // Fetch NDC → GEN- map from Acumatica
  var fetchPerWarehouseCostMap = useCallback(async function() {
    if (!cred || !cred.username || !cred.password) return null;
    try {
      var resp = await fetch("/api/acumatica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "gen-pricing-3prx", username: cred.username, password: cred.password }),
      });
      var json = await resp.json();
      if (!resp.ok) return null;
      var data = json.data || [];
      // Map from labeled column name to warehouse code we'll match against r.warehouse
      var WH_COL = {
        "TP-NY":  "TPNYAvgCost",
        "TP-OH":  "TPOHAvgCost",
        "TP-CA":  "TPCAAvgCost",
        "TP-MI":  "TPMIAvgCost",
        "TP-FL":  "TPFLAvgCost",
        "GGM":    "GGMAvgCost",
        "GGM-KY": "GGMKYAvgCost",
        "GGM-AZ": "GGMAZAvgCost",
      };
      var map = {};
      data.forEach(function(row) {
        var invId = (row.InventoryID || "").trim();
        if (!invId) return;
        var perWh = {};
        Object.keys(WH_COL).forEach(function(wh) {
          var col = WH_COL[wh];
          var val = parseFloat(row[col]);
          if (!isNaN(val) && val > 0) perWh[wh] = val;
        });
        map[invId] = perWh;
      });
      return map;
    } catch (err) { return null; }
  }, [cred]);

  var fetchUomConversionMap = useCallback(async function() {
    if (!cred || !cred.username || !cred.password) return null;
    try {
      var resp = await fetch("/api/acumatica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "uom-conversions", username: cred.username, password: cred.password }),
      });
      var json = await resp.json();
      if (!resp.ok) return null;
      var data = json.data || [];
      // Build nested map: { invId: { TO_UOM: { factor, op, fromUnit, baseUnit } } }
      var map = {};
      data.forEach(function(row) {
        var invId = (row.InventoryID || "").trim();
        if (!invId) return;
        var toUnit = (row.ToUnit || "").trim().toUpperCase();
        var fromUnit = (row.FromUnit || "").trim().toUpperCase();
        var baseUnit = (row.BaseUnit || "").trim().toUpperCase();
        var factor = parseFloat(row.ConversionFactor);
        if (!toUnit || isNaN(factor) || factor <= 0) return;
        var op = (row.MultiplyDivide || "Multiply").toLowerCase().indexOf("div") >= 0 ? "Divide" : "Multiply";
        if (!map[invId]) map[invId] = {};
        map[invId][toUnit] = { factor: factor, op: op, fromUnit: fromUnit, baseUnit: baseUnit };
      });
      return map;
    } catch (err) { return null; }
  }, [cred]);

  var fetchAvgCostMap = useCallback(async function() {
    if (!cred || !cred.username || !cred.password) return null;
    try {
      var resp = await fetch("/api/acumatica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "gen-pricing", username: cred.username, password: cred.password }),
      });
      var json = await resp.json();
      if (!resp.ok) return null;
      var data = json.data || [];
      var map = {};
      data.forEach(function(row) {
        var invId = (row.InventoryID || "").trim();
        if (!invId) return;
        var avgCost = parseFloat(row.AverageCost);
        var multiplier = parseFloat(row.Multiplier);
        var defaultPrice = parseFloat(row.DefaultPrice);
        map[invId] = {
          avgCost: isNaN(avgCost) ? null : avgCost,
          multiplier: isNaN(multiplier) ? 1 : multiplier,
          defaultPrice: isNaN(defaultPrice) ? null : defaultPrice,
        };
      });
      return map;
    } catch (err) { return null; }
  }, [cred]);

  var fetchNdcMap = useCallback(async function(forceFresh) {
    if (!cred || !cred.username || !cred.password) { toast("Please log in first", "error"); return null; }
    setNdcLoading(true);
    try {
      var resp = await fetch("/api/acumatica" + (forceFresh ? "?refresh=1" : ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ndc-lookup", username: cred.username, password: cred.password }),
      });
      var json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Acumatica lookup failed");
      var data = json.data || [];
      var map = {};
      data.forEach(function(row) {
        var altId = (row.AlternateID || "").trim();
        var invId = (row.InventoryID || "").trim();
        var desc = row.Description || "";
        var uom = row.UOM || "";
        if (!altId) return;
        var variants = ndcVariants(altId);
        variants.forEach(function(v) { map[v] = { inventoryId: invId, description: desc, uom: uom }; });
        map[normalizeNdc(altId)] = { inventoryId: invId, description: desc, uom: uom };
      });
      setNdcMap(map);
      toast("Loaded " + data.length + " NDC records from Acumatica");
      return map;
    } catch (err) {
      toast("NDC Lookup error: " + err.message, "error");
      return null;
    } finally { setNdcLoading(false); }
  }, [cred, toast]);

  function lookupNdc(ndc, map) {
    if (!map) return null;
    var norm = normalizeNdc(ndc);
    if (map[norm]) return map[norm];
    if (map[ndc]) return map[ndc];
    var vars = ndcVariants(ndc);
    for (var k = 0; k < vars.length; k++) { if (map[vars[k]]) return map[vars[k]]; }
    return null;
  }


  async function handleValidate() {
    if (pdfs.length === 0) { toast("Upload at least one PDF", "error"); return; }
    if (!ok) { lp(); return; }
    setLoading(true); setError(null); setResults([]); setMckWarnings([]);
    try {
      // Step 1: Parse each PDF separately to avoid text extraction state issues
      var pdfItems = [];
      var newStatedAmounts = {};
      for (var pi = 0; pi < pdfs.length; pi++) {
        var parseResp = await fetch("/api/po-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfs: [pdfs[pi]], vendorHint: vendor }),
        });
        var parseJson = await parseResp.json();
        if (!parseResp.ok) throw new Error(parseJson.error || "Parse failed for " + pdfs[pi].name);
        if (parseJson.error) throw new Error(parseJson.error);
        var items = parseJson.items || [];
        items.forEach(function(item) { item.sourceFile = pdfs[pi].name; });
        pdfItems = pdfItems.concat(items);
        if (parseJson.statedAmount != null) { newStatedAmounts[pdfs[pi].name] = Math.round(parseJson.statedAmount * 100) / 100; }
      }
      if (pdfItems.length === 0) throw new Error("No items found. The PDF parser returned 0 NDCs. Check that your PDFs have the standard PO format.");

      // Step 2: Fetch fresh NDC map, avg cost map (general + per-warehouse), and UOM conversions in parallel
      var mapResults = await Promise.all([fetchNdcMap(), fetchAvgCostMap(), fetchUomConversionMap(), fetchPerWarehouseCostMap()]);
      var map = mapResults[0];
      var avgCostMap = mapResults[1] || {};
      var uomMap = mapResults[2] || {};
      var perWhCostMap = mapResults[3] || {};
      if (!map) throw new Error("Could not fetch NDC data from Acumatica. Check your login.");

      // Step 3: Match each item's NDC against OData
      var matched = pdfItems.map(function(item) {
        var match = lookupNdc(item.ndc, map);
        var invId = match ? match.inventoryId : null;
        var pricing = invId && avgCostMap[invId] ? avgCostMap[invId] : null;
        var uom = match ? (match.uom || "").toUpperCase() : "";
        // Look up conversion: how many base units (e.g., tablets) per 1 PO unit (e.g., BT100)
        var conv = (invId && uom && uomMap[invId] && uomMap[invId][uom]) ? uomMap[invId][uom] : null;
        var convFactor = null;
        if (conv) {
          convFactor = conv.op === "Divide" ? (1 / conv.factor) : conv.factor;
        }
        // Resolve avg cost: prefer per-warehouse from 3PRx GI, else fall back to general avg cost
        var resolvedAvgCost = null;
        var avgCostSource = null;
        var wh = item.warehouse;
        if (invId && wh && perWhCostMap[invId] && perWhCostMap[invId][wh] != null) {
          resolvedAvgCost = perWhCostMap[invId][wh];
          avgCostSource = "3prx:" + wh;
        } else if (pricing && pricing.avgCost != null) {
          resolvedAvgCost = pricing.avgCost;
          avgCostSource = "general";
        }
        return {
          ndc: item.ndc,
          drugName: item.drugName,
          qty: item.qty,
          totalPrice: item.totalPrice != null ? Math.round(item.totalPrice * 100) / 100 : null,
          unitPrice: item.unitPrice != null ? Math.round(item.unitPrice * 100) / 100 : null,
          warehouse: item.warehouse,
          vendorSource: item.vendorSource,
          vendorItemNum: item.vendorItemNum,
          poNumber: item.poNumber,
          sourceFile: item.sourceFile,
          inventoryId: invId,
          acumaticaDesc: match ? match.description : null,
          uom: match ? match.uom : null,
          ndcFound: !!match,
          avgCost: resolvedAvgCost,
          avgCostSource: avgCostSource,
          multiplier: pricing ? pricing.multiplier : null,
          defaultPrice: pricing ? pricing.defaultPrice : null,
          uomConvFactor: convFactor,
        };
      });

      // Step 4: McKesson portal cross-reference (using NDCs from pasted table)
      var warnings = [];
      if (vendor === "mckesson" && mckParsed && mckParsed.length > 0) {
        var portalNdcs = mckParsed.map(function(item) { return item.ndc; }); // already normalized (no dashes)
        var mckItems = matched.filter(function(r) { return r.vendorSource === "McKesson"; });
        var pdfNdcs = mckItems.map(function(r) { return normalizeNdcForCompare(r.ndc); }).filter(Boolean);

        // Items in PDF but NOT in portal
        var inPdfOnly = mckItems.filter(function(r) {
          var ndcNorm = normalizeNdcForCompare(r.ndc);
          return ndcNorm && portalNdcs.indexOf(ndcNorm) < 0;
        });
        inPdfOnly.forEach(function(item) {
          warnings.push({ type: "pdf-only", msg: item.drugName + " (NDC " + item.ndc + ") is in the PDF but NOT on the McKesson portal", item: item });
        });

        // Items in portal but NOT in PDF
        var inPortalOnly = mckParsed.filter(function(pi) {
          return pi.ndc && pdfNdcs.indexOf(pi.ndc) < 0;
        });
        inPortalOnly.forEach(function(pi) {
          var desc = pi.description ? " — " + pi.description : "";
          warnings.push({ type: "screenshot-only", msg: "NDC " + pi.ndc + desc + " is on the McKesson portal but NOT in the PDF", item: null });
        });

        // Quantity mismatches
        mckItems.forEach(function(pdfItem) {
          var ndcNorm = normalizeNdcForCompare(pdfItem.ndc);
          var portalMatch = mckParsed.find(function(pi) { return pi.ndc === ndcNorm; });
          if (portalMatch && portalMatch.qty && pdfItem.qty && portalMatch.qty !== pdfItem.qty) {
            warnings.push({ type: "qty-mismatch", msg: pdfItem.drugName + " (NDC " + pdfItem.ndc + "): PDF says qty " + pdfItem.qty + " but portal shows " + portalMatch.qty, item: pdfItem });
          }
        });

        // Override unit prices with McKesson CSV Est. Net Price
        if (Object.keys(mckPortalPrices).length > 0) {
          matched.forEach(function(r) {
            var ndcNorm = normalizeNdcForCompare(r.ndc);
            if (mckPortalPrices[ndcNorm] != null) {
              r.unitPrice = Math.round(mckPortalPrices[ndcNorm] * 100) / 100;
              r.totalPrice = r.qty ? +(r.qty * r.unitPrice).toFixed(2) : r.totalPrice;
            }
          });
        }
      }

      setResults(matched);
      setStatedAmounts(function(prev) { return Object.assign({}, prev, newStatedAmounts); });
      // Auto-select first file tab for "other" vendor
      if (vendor === "other" && matched.length > 0) {
        var files = {}; matched.forEach(function(r) { if (r.sourceFile) files[r.sourceFile] = 1; });
        var fileList = Object.keys(files);
        if (fileList.length > 0) setActiveFileTab(fileList[0]);
      }
      setMckWarnings(warnings);
      var foundCount = matched.filter(function(r) { return r.ndcFound; }).length;
      toast("Validated " + matched.length + " items: " + foundCount + " matched in OData, " + (matched.length - foundCount) + " not found");
    } catch (err) {
      setError(err.message);
      toast("Validation failed: " + err.message, "error");
    } finally { setLoading(false); }
  }

  function downloadCSV(rows) {
    var csvRows = rows || results;
    var header = "Status,Inventory ID,Warehouse,Description (Acumatica),UOM,Drug Name (PO),Alternate ID,Vendor,Order Qty.,Unit Cost,Ext. Cost,PO#,Source File\r\n";
    var lines = csvRows.map(function(r) {
      var editedQty = screenshotQtys[r.ndc] != null ? parseInt(screenshotQtys[r.ndc]) : r.qty;
      var editedPrice = editedPrices[r.ndc] != null ? parseFloat(editedPrices[r.ndc]) : r.unitPrice;
      var extCost = (editedQty && editedPrice) ? (editedQty * editedPrice).toFixed(2) : (r.totalPrice || "");
      return [r.ndcFound ? "MATCHED" : "NOT FOUND", r.inventoryId || "", r.warehouse, r.acumaticaDesc || "", r.uom || "", r.drugName, r.ndc, r.vendorSource, editedQty || "", editedPrice ? editedPrice.toFixed(4) : "", extCost, r.poNumber, r.sourceFile || ""]
        .map(function(v) { return "\"" + String(v == null ? "" : v).replace(/"/g, "\"\"") + "\""; }).join(",");
    });
    var csv = header + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    var d = new Date();
    var dateStr = (d.getMonth() + 1) + "." + d.getDate() + "." + String(d.getFullYear()).slice(2);
    var vendors = {}; var pos = {}; var whs = {};
    csvRows.forEach(function(r) { if (r.vendorSource) vendors[r.vendorSource] = 1; if (r.poNumber) pos[r.poNumber] = 1; if (r.warehouse) whs[r.warehouse] = 1; });
    var vendorStr = Object.keys(vendors).join(" ") || "Unknown";
    var poStr = Object.keys(pos).map(function(p) { return "#" + p; }).join(" ") || "";
    var whStr = Object.keys(whs).join(" ");
    a.download = dateStr + " " + vendorStr + " " + (whStr ? whStr + " " : "") + "PO " + poStr + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setPdfs([]); setMckPaste(""); setMckParsed(null); setMckFile(null); setMckPortalPrices({}); setScreenshotQtys({}); setEditedPrices({}); setResults([]); setMckWarnings([]); setError(null); setActiveFileTab(null); setStatedAmounts({});
  }

  // ── Acumatica auto-create: group results into POs, then validate each ─────
  // Returns { pos: [...], blocked: [...] } where pos is ready-to-create and blocked
  // is per-file/group reasons we can't proceed (e.g. unmatched NDC, missing vendor ref).
  function buildAcumaticaPOs() {
    if (results.length === 0) return { pos: [], blocked: [] };
    // Group by sourceFile: McKesson is always 1 PDF so this collapses to 1 group;
    // other / GGM may have multiple PDFs => multiple POs.
    var groupsByFile = {};
    results.forEach(function(r) {
      var key = r.sourceFile || "(unknown)";
      if (!groupsByFile[key]) groupsByFile[key] = [];
      groupsByFile[key].push(r);
    });

    // Section-driven config
    var sectionConfig;
    if (vendor === "mckesson") {
      sectionConfig = { vendorId: "VID0041", descriptionMode: "fixed", description: "McKesson" };
    } else if (vendor === "ggm-crossovers") {
      sectionConfig = { vendorId: "VID0016", descriptionMode: "blank" };
    } else {
      // "other" — Keysource/Anda/Bloodworth. Description comes from each item's vendorSource.
      sectionConfig = { vendorId: "VID0041", descriptionMode: "perFile" };
    }

    var pos = [];
    var blocked = [];
    Object.keys(groupsByFile).forEach(function(fileKey) {
      var items = groupsByFile[fileKey];
      // Pull metadata that should be consistent across items in one PDF:
      // vendorRef (poNumber), warehouse, vendorSource.
      var vendorRefs = {};
      var warehouses = {};
      var vendorSources = {};
      items.forEach(function(r) {
        if (r.poNumber) vendorRefs[r.poNumber] = 1;
        if (r.warehouse) warehouses[r.warehouse] = 1;
        if (r.vendorSource) vendorSources[r.vendorSource] = 1;
      });
      var vendorRefList = Object.keys(vendorRefs);
      var warehouseList = Object.keys(warehouses);
      var vendorSourceList = Object.keys(vendorSources);

      // Validation: must have exactly one of each (PDF integrity check)
      if (vendorRefList.length === 0) {
        blocked.push({ file: fileKey, reason: "No vendor reference (poNumber) parsed from PDF" });
        return;
      }
      if (vendorRefList.length > 1) {
        blocked.push({ file: fileKey, reason: "Multiple vendor references in one PDF: " + vendorRefList.join(", ") });
        return;
      }
      if (warehouseList.length === 0) {
        blocked.push({ file: fileKey, reason: "No warehouse parsed from PDF" });
        return;
      }
      if (warehouseList.length > 1) {
        blocked.push({ file: fileKey, reason: "Multiple warehouses in one PDF: " + warehouseList.join(", ") });
        return;
      }

      // Strict matching: refuse the PO if ANY item didn't find its inventory ID
      var unmatched = items.filter(function(r) { return !r.ndcFound || !r.inventoryId; });
      if (unmatched.length > 0) {
        blocked.push({
          file: fileKey,
          reason: unmatched.length + " item(s) not matched in Acumatica: " + unmatched.slice(0, 3).map(function(r) { return r.ndc; }).join(", ") + (unmatched.length > 3 ? " +" + (unmatched.length - 3) + " more" : "")
        });
        return;
      }

      // Description per section
      var description;
      if (sectionConfig.descriptionMode === "fixed") {
        description = sectionConfig.description;
      } else if (sectionConfig.descriptionMode === "blank") {
        description = "";
      } else {
        // perFile: use the (unique) vendorSource from the PDF; if absent or multi, error
        if (vendorSourceList.length === 0) {
          blocked.push({ file: fileKey, reason: "PDF parser did not detect sub-vendor (Keysource/Anda/Bloodworth)" });
          return;
        }
        if (vendorSourceList.length > 1) {
          blocked.push({ file: fileKey, reason: "Multiple sub-vendors detected in one PDF: " + vendorSourceList.join(", ") });
          return;
        }
        description = vendorSourceList[0];
      }

      var warehouse = warehouseList[0];
      // Build line items with edited prices / edited qtys taking precedence
      var lines = items.map(function(r) {
        var qty = screenshotQtys[r.ndc] != null ? parseInt(screenshotQtys[r.ndc]) : r.qty;
        var price = editedPrices[r.ndc] != null ? parseFloat(editedPrices[r.ndc]) : r.unitPrice;
        return {
          inventoryId: r.inventoryId,
          warehouse: warehouse,
          orderQty: qty,
          unitCost: price || 0,
          uom: r.uom || ""
        };
      });
      // Sanity: positive qty + non-empty uom for every line (the route will also enforce)
      var badLine = lines.find(function(l) { return !(Number(l.orderQty) > 0) || !l.uom; });
      if (badLine) {
        blocked.push({ file: fileKey, reason: "Some line(s) have zero qty or missing UOM" });
        return;
      }

      pos.push({
        file: fileKey,
        vendorId: sectionConfig.vendorId,
        location: warehouse,           // Location matches warehouse (TP-OH, GGM-KY, etc.)
        description: description,
        vendorRef: vendorRefList[0],
        lines: lines,
        lineCount: lines.length,
        orderTotal: lines.reduce(function(s, l) { return s + (Number(l.orderQty) * Number(l.unitCost)); }, 0)
      });
    });

    return { pos: pos, blocked: blocked };
  }

  function onCreatePOsClick() {
    if (!ok) { lp(); return; }
    var built = buildAcumaticaPOs();
    if (built.pos.length === 0) {
      if (built.blocked.length > 0) {
        toast("Cannot create any POs. " + built.blocked.length + " blocked \u2014 see below", "error");
        setAcuCreateConfirm({ pos: [], blocked: built.blocked });
      } else {
        toast("Nothing to create \u2014 no parsed results", "error");
      }
      return;
    }
    setAcuCreateConfirm({ pos: built.pos, blocked: built.blocked });
  }

  async function executeCreatePOs(posToCreate) {
    setAcuCreateConfirm(null);
    setAcuCreateLoading(true);
    try {
      var resp = await fetch("/api/acumatica-po-import-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cred.username,
          password: cred.password,
          pos: posToCreate.map(function(p) {
            return {
              vendorId: p.vendorId,
              location: p.location,
              description: p.description,
              vendorRef: p.vendorRef,
              lines: p.lines
            };
          })
        })
      });
      var data = await resp.json();
      setAcuCreateResult({ data: data, requested: posToCreate });
      if (data.ok) {
        toast("Created " + (data.succeeded ? data.succeeded.length : 0) + " PO(s) in Acumatica", "success");
      } else {
        var succ = data.succeeded ? data.succeeded.length : 0;
        var attempted = succ + 1; // we stop on first failure
        toast(succ + "/" + posToCreate.length + " created \u2014 stopped on failure (see results)", "error");
      }
    } catch (err) {
      setAcuCreateResult({ data: { ok: false, stage: "fetch-error", failure: { stage: "fetch", errorDetails: [{ message: String(err) }] }, succeeded: [] }, requested: posToCreate });
      toast("Network error \u2014 see results", "error");
    } finally {
      setAcuCreateLoading(false);
    }
  }


  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);
  var fileList = useMemo(function() { if (vendor !== "other" || results.length === 0) return []; var f = {}; results.forEach(function(r) { if (r.sourceFile) f[r.sourceFile] = (f[r.sourceFile] || 0) + 1; }); return Object.keys(f).map(function(name) { return { name: name, count: f[name] }; }); }, [results, vendor]);
  var activeResults = useMemo(function() { if (vendor !== "other" || !activeFileTab || fileList.length <= 1) return results; return results.filter(function(r) { return r.sourceFile === activeFileTab; }); }, [results, vendor, activeFileTab, fileList]);
  var _deltaSort = useState(null), deltaSort = _deltaSort[0], setDeltaSort = _deltaSort[1];
  function computeDeltaPct(r) {
    if (r.avgCost == null || r.avgCost <= 0) return null;
    var avgPerPkg = r.uomConvFactor && r.uomConvFactor > 0 ? r.avgCost * r.uomConvFactor : r.avgCost;
    if (avgPerPkg <= 0) return null;
    var unitCost = editedPrices[r.ndc] != null ? parseFloat(editedPrices[r.ndc]) : r.unitPrice;
    if (!unitCost) return null;
    return ((unitCost - avgPerPkg) / avgPerPkg) * 100;
  }
  var sortedActiveResults = useMemo(function() {
    if (!deltaSort) return activeResults;
    var withPct = activeResults.map(function(r, i) { return { r: r, i: i, pct: computeDeltaPct(r) }; });
    withPct.sort(function(a, b) {
      // Rows without Δ% go to bottom regardless of sort direction
      if (a.pct == null && b.pct == null) return a.i - b.i;
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return deltaSort === "desc" ? b.pct - a.pct : a.pct - b.pct;
    });
    return withPct.map(function(x) { return x.r; });
  }, [activeResults, deltaSort, editedPrices]);
  var foundCount = activeResults.filter(function(r) { return r.ndcFound; }).length;
  var notFoundCount = activeResults.length - foundCount;
  var qtyMismatchCount = activeResults.filter(function(r) { return screenshotQtys[r.ndc] != null && parseInt(screenshotQtys[r.ndc]) !== r.qty; }).length;

  return (
    <div>
      <p style={{ color: "#6B7280", fontSize: 13, marginBottom: 20 }}>Upload vendor PO PDFs to extract NDCs, then validate against Acumatica <strong>Generic Current NDCs</strong> OData to find GEN- Inventory IDs.</p>

      <div style={S.card}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Vendor Type</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#6B7280" }}>
              <button onClick={function() { fetchNdcMap(true).then(function(r) { if (r) toast("NDC map refreshed from Acumatica"); }); }} disabled={ndcLoading} title="Force re-fetch the Generic NDCs map from Acumatica, bypassing cache. Use this after you've just added or changed a generic in Acumatica." style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: TOOL_COLOR, cursor: ndcLoading ? "not-allowed" : "pointer", fontFamily: "'Varela Round', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>{ndcLoading ? "Refreshing\u2026" : "\u21BB Refresh NDC map"}</button>
              <span style={{ fontWeight: 500 }}>{"\u0394% Unit Cost Threshold"}</span>
              <input type="number" min="1" step="1" value={flagThreshold} onChange={function(e) { updateFlagThreshold(e.target.value); }} style={{ width: 64, padding: "5px 8px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12, color: "#374151", outline: "none", textAlign: "center", fontFamily: "'Varela Round', sans-serif", background: "#F9FAFB" }} />
              <span>%</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[["other", "Keysource / Anda / Bloodworth"], ["mckesson", "McKesson"], ["ggm-crossovers", "GoGoMeds Crossovers"]].map(function(v) {
              return <button key={v[0]} onClick={function() { switchVendor(v[0]); }}
                style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid " + (vendor === v[0] ? TOOL_COLOR : "#E5E7EB"), background: vendor === v[0] ? TOOL_COLOR + "20" : "transparent", color: vendor === v[0] ? TOOL_COLOR : "#6B7280", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{v[1]}</button>;
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: vendor === "mckesson" ? "1fr 1fr" : "1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, marginBottom: 6 }}>{vendor === "mckesson" ? "PO PDF" : "PO PDF(s)"}</div>
            {pdfs.length > 0 ? <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
                <span style={{ color: "#059669", fontSize: 12 }}>{"\u2713"} {pdfs.length} PDF{pdfs.length > 1 ? "s" : ""}: {pdfs.map(function(p) { return p.name; }).join(", ")}</span>
                <button onClick={function() { setPdfs([]); }} style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>{"\u00D7"}</button>
              </div>
            </div> : vendor === "mckesson" ? <DropZone accept=".pdf" label="PO PDF" sublabel="Drop 1 PDF" icon="pdf" color={TOOL_COLOR} onFiles={function(files) { handlePdfChange([files[0]]); }} /> : <DropZone accept=".pdf" multiple label="PO PDF(s)" sublabel="Drop PDFs or click to browse" icon="pdf" color={TOOL_COLOR} onFiles={handlePdfChange} />}
          </div>
          {vendor === "mckesson" && <div>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, marginBottom: 6 }}>McKesson Export CSV <InfoTip text="Have the WM download the order from the McKesson portal as CSV. Key columns: FilledNdcUpc, OrderQty, Est. Net Price." /></div>
            {mckFile && mckParsed ? <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
                <span style={{ color: "#059669", fontSize: 12 }}>{"\u2713"} {mckFile.name} — {mckParsed.length} items, {Object.keys(mckPortalPrices).length} prices</span>
                <button onClick={function() { setMckFile(null); setMckParsed(null); setMckPortalPrices({}); }} style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>{"\u00D7"}</button>
              </div>
            </div> : <DropZone accept=".csv" label="McKesson Export CSV" sublabel="Drop CSV from McKesson portal" icon="spreadsheet" color={TOOL_COLOR} disabled={mckFileLoading} onFiles={handleMckFileUpload} />}
            {mckFileLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}><Spinner color={TOOL_COLOR} size={14} /><span style={{ fontSize: 12, color: TOOL_COLOR }}>Parsing CSV...</span></div>}
            <div style={{ marginTop: 10, fontSize: 11, color: "#9CA3AF" }}>Or paste NDCs manually (one per line):</div>
            <textarea value={mckPaste} onChange={handleMckManualPaste} placeholder={"67877019710\n29300041001\n53746075101\n..."} rows={3} style={Object.assign({}, S.inp, { resize: "vertical", fontFamily: "monospace", fontSize: 12, marginTop: 4 })} />
          </div>}
        </div>

        {vendor === "mckesson" && mckParsed && mckParsed.length > 0 && <div style={{ marginTop: 16, background: "#F8F9FB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>McKesson Items ({mckParsed.length}){Object.keys(mckPortalPrices).length > 0 && <span style={{ color: "#059669", fontWeight: 600, marginLeft: 8 }}>{"\u2713"} {Object.keys(mckPortalPrices).length} prices loaded</span>}</div>
          <div style={{ maxHeight: 100, overflow: "auto", fontSize: 12, fontFamily: "monospace", color: "#6B7280" }}>
            {mckParsed.map(function(pi, idx) { return <div key={idx} style={{ display: "flex", gap: 16 }}><span>{pi.ndc}</span>{mckPortalPrices[pi.ndc] != null && <span style={{ color: "#059669" }}>{"$" + mckPortalPrices[pi.ndc].toFixed(2)}</span>}{pi.qty && <span style={{ color: "#9CA3AF" }}>qty: {pi.qty}</span>}</div>; })}
          </div>
        </div>}

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={handleValidate} disabled={loading || pdfs.length === 0}
            style={Object.assign({}, S.btn(), { padding: "10px 20px", opacity: (loading || pdfs.length === 0) ? 0.5 : 1 })}>
            {loading ? <><Spinner /> Parsing & Validating...</> : <><IconUpload /> Parse & Validate NDCs</>}
          </button>
          {(pdfs.length > 0 || mckParsed || results.length > 0) && <button onClick={reset} style={Object.assign({}, S.btn("ghost"), { padding: "10px 16px", marginLeft: "auto" })}><IconTrash /> Clear</button>}
        </div>
      </div>

      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>Error: {error}</div>}

      {mckWarnings.length > 0 && <div style={{ marginBottom: 16 }}>
        {mckWarnings.map(function(w, i) {
          var isPdfOnly = w.type === "pdf-only";
          var isQtyMismatch = w.type === "qty-mismatch";
          var bgColor = isPdfOnly ? "rgba(245,158,11,0.08)" : isQtyMismatch ? "rgba(239,68,68,0.08)" : "rgba(139,92,246,0.08)";
          var borderColor = isPdfOnly ? "rgba(245,158,11,0.3)" : isQtyMismatch ? "rgba(239,68,68,0.3)" : "rgba(139,92,246,0.3)";
          var textColor = isPdfOnly ? "#D97706" : isQtyMismatch ? "#DC2626" : "#7C3AED";
          return <div key={i} style={{ background: bgColor, border: "1px solid " + borderColor, borderRadius: 10, padding: "10px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <IconAlert />
            <span style={{ fontSize: 13, color: textColor, flex: 1 }}>{w.msg}</span>
            <button onClick={function() { setMckWarnings(function(prev) { return prev.filter(function(_, idx) { return idx !== i; }); }); }} style={{ background: "transparent", border: "1px solid " + borderColor, borderRadius: 6, padding: "3px 8px", fontSize: 11, color: textColor, cursor: "pointer", flexShrink: 0 }}>Dismiss</button>
          </div>;
        })}
      </div>}

      {results.length > 0 && <div>
        {/* File tabs for "other" vendor with multiple files */}
        {vendor === "other" && fileList.length > 1 && <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#FFFFFF", borderRadius: 10, padding: 3, border: "0.5px solid #E5E7EB", overflowX: "auto" }}>
          {fileList.map(function(f) { var isActive = activeFileTab === f.name; return <button key={f.name} onClick={function() { setActiveFileTab(f.name); }} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, background: isActive ? TOOL_COLOR : "transparent", color: isActive ? "#fff" : "#6B7280" }}>{f.name.replace(".pdf", "")}<span style={{ fontSize: 10, background: isActive ? "rgba(255,255,255,0.25)" : "rgba(100,116,139,0.15)", padding: "1px 6px", borderRadius: 4 }}>{f.count}</span></button>; })}
        </div>}
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {(function() { var pos = {}; var vendors = {}; var whs = {}; activeResults.forEach(function(r) { if (r.poNumber) pos[r.poNumber] = 1; if (r.vendorSource) vendors[r.vendorSource] = 1; if (r.warehouse) whs[r.warehouse] = 1; }); var poList = Object.keys(pos); var vendorList = Object.keys(vendors); var whList = Object.keys(whs); function copyVal(val) { navigator.clipboard.writeText(val).then(function() { toast("Copied: " + val); }).catch(function() {}); } return <>{poList.length > 0 && <div onClick={function() { copyVal(poList.join(", ")); }} style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0, cursor: "pointer", transition: "all 0.15s" })} title="Click to copy"><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>PO #</div><div style={{ fontSize: 20, fontWeight: 700, color: TOOL_COLOR, marginTop: 4 }}>{poList.join(", ")}</div></div>}{vendorList.length > 0 && <div onClick={function() { copyVal(vendorList.join(", ")); }} style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0, cursor: "pointer", transition: "all 0.15s" })} title="Click to copy"><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Vendor</div><div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginTop: 4 }}>{vendorList.join(", ")}</div></div>}{whList.length > 0 && <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Warehouse</div><div style={{ fontSize: 20, fontWeight: 700, color: "#1F2937", marginTop: 4 }}>{whList.join(", ")}</div></div>}</>; })()}
          {(function() { var totalExt = 0; activeResults.forEach(function(r) { var eq = screenshotQtys[r.ndc] != null ? parseInt(screenshotQtys[r.ndc]) : r.qty; var ep = editedPrices[r.ndc] != null ? parseFloat(editedPrices[r.ndc]) : r.unitPrice; if (eq && ep) totalExt += Math.round(eq * ep * 100) / 100; else if (r.totalPrice) totalExt += r.totalPrice; }); var activeStated = null; if (vendor === "other" && activeFileTab && statedAmounts[activeFileTab] != null) { var currentFiles = {}; results.forEach(function(r) { if (r.sourceFile) currentFiles[r.sourceFile] = 1; }); if (currentFiles[activeFileTab]) { activeStated = statedAmounts[activeFileTab]; } } var matches = activeStated != null ? Math.abs(totalExt - activeStated) < 0.02 : null; return <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Total Price</div><div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}><span style={{ fontSize: 20, fontWeight: 700, color: "#1F2937" }}>{"$" + totalExt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>{matches === true && <span style={{ color: "#059669", fontSize: 16 }}>{"\u2713"}</span>}{matches === false && <span style={{ color: "#DC2626", fontSize: 11, fontWeight: 500 }}>{"\u2717 off $" + Math.abs(totalExt - activeStated).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}</div></div>; })()}
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Total Items</div><div style={{ fontSize: 24, fontWeight: 700, color: "#1F2937", marginTop: 4 }}>{activeResults.length}</div></div>
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>In OData</div><div style={{ fontSize: 24, fontWeight: 700, color: "#059669", marginTop: 4 }}>{foundCount}</div></div>
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Not in OData</div><div style={{ fontSize: 24, fontWeight: 700, color: notFoundCount > 0 ? "#DC2626" : "#059669", marginTop: 4 }}>{notFoundCount}</div></div>
          {vendor === "mckesson" && <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Qty Edited</div><div style={{ fontSize: 24, fontWeight: 700, color: qtyMismatchCount > 0 ? "#D97706" : "#059669", marginTop: 4 }}>{qtyMismatchCount}</div></div>}
          {mckWarnings.length > 0 && <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>MCK Warnings</div><div style={{ fontSize: 24, fontWeight: 700, color: "#D97706", marginTop: 4 }}>{mckWarnings.length}</div></div>}
        </div>

        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #E5E7EB" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>Translation Results</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={reset} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}><IconTrash /> Clear</button>
              {vendor === "other" && fileList.length > 1 && <button onClick={function() { downloadCSV(activeResults); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}><IconCSV /> Download Tab</button>}
              {vendor === "other" && fileList.length > 1 && <button onClick={function() { fileList.forEach(function(f, idx) { setTimeout(function() { downloadCSV(results.filter(function(r) { return r.sourceFile === f.name; })); }, idx * 300); }); }} style={Object.assign({}, S.btn(), { padding: "6px 14px", fontSize: 12 })}><IconCSV /> Download All ({fileList.length} files)</button>}
              {!(vendor === "other" && fileList.length > 1) && <button onClick={function() { downloadCSV(results); }} style={Object.assign({}, S.btn(), { padding: "6px 14px", fontSize: 12 })}><IconCSV /> Download CSV</button>}
              <button onClick={onCreatePOsClick} disabled={acuCreateLoading || !ok} style={{ background: (acuCreateLoading || !ok) ? "#D1D5DB" : "#047857", color: "#FFFFFF", border: "none", padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: (acuCreateLoading || !ok) ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }} title={!ok ? "Acumatica credentials required" : "Create the parsed POs in Acumatica"}>{acuCreateLoading ? <><Spinner /> Creating...</> : <>{"\u2192"} Create POs in Acumatica</>}</button>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
            <thead><tr>
              <th style={S.th}>OData Status</th>
              <th style={S.th}>NDC</th>
              <th style={S.th}>GEN- Inventory ID</th>
              <th style={S.th}>Description (Acumatica)</th>
              <th style={S.th}>UOM</th>
              <th style={S.th}>Drug Name (PO)</th>
              <th style={S.th}>Vendor</th>
              <th style={Object.assign({}, S.th, { textAlign: "center" })}>Qty</th>
              <th style={Object.assign({}, S.th, { textAlign: "right" })}>Unit Cost</th>
              <th style={Object.assign({}, S.th, { textAlign: "right" })}>Ext. Cost</th>
              <th style={Object.assign({}, S.th, { textAlign: "right" })}>Avg Unit Cost</th>
              <th onClick={function() { setDeltaSort(deltaSort === "desc" ? "asc" : deltaSort === "asc" ? null : "desc"); }} style={Object.assign({}, S.th, { textAlign: "right", cursor: "pointer", userSelect: "none" })}>{"\u0394% Unit Cost"}{deltaSort === "desc" ? " \u25BE" : deltaSort === "asc" ? " \u25B4" : ""}</th>
              {vendor === "mckesson" && <th style={S.th}>MCK Item #</th>}
              <th style={S.th}>Source</th>
            </tr></thead>
            <tbody>{sortedActiveResults.map(function(r, i) {
              var editedQty = screenshotQtys[r.ndc] != null ? parseInt(screenshotQtys[r.ndc]) : r.qty;
              var qtyChanged = screenshotQtys[r.ndc] != null && parseInt(screenshotQtys[r.ndc]) !== r.qty;
              var editedPrice = editedPrices[r.ndc] != null ? parseFloat(editedPrices[r.ndc]) : r.unitPrice;
              var priceChanged = editedPrices[r.ndc] != null && parseFloat(editedPrices[r.ndc]) !== r.unitPrice;
              var extCost = (editedQty && editedPrice) ? Math.round(editedQty * editedPrice * 100) / 100 : r.totalPrice;
              return <tr key={i} style={{ background: (qtyChanged || priceChanged) ? "rgba(245,158,11,0.06)" : (r.ndcFound ? "transparent" : "rgba(239,68,68,0.04)") }}>
                <td style={S.td}><span style={S.badge(r.ndcFound ? "success" : "danger")}>{r.ndcFound ? <><IconCheck /> Match</> : <><IconAlert /> Missing</>}</span></td>
                <td style={S.td}>{r.ndc}</td>
                <td style={Object.assign({}, S.td, { color: r.inventoryId ? "#059669" : "#9CA3AF" })}>{r.inventoryId || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { maxWidth: 220, wordBreak: "break-word" })}>{r.acumaticaDesc || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { color: r.uom ? "#06B6D4" : "#9CA3AF" })}>{r.uom || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { color: "#6B7280", maxWidth: 200, wordBreak: "break-word" })}>{r.drugName || "\u2014"}</td>
                <td style={S.td}>{r.vendorSource || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { textAlign: "center" })}><input style={Object.assign({}, S.inp, { width: 70, padding: "6px 8px", textAlign: "center", color: qtyChanged ? "#D97706" : "#374151", background: qtyChanged ? "rgba(245,158,11,0.1)" : "#F8F9FB" })} type="number" value={screenshotQtys[r.ndc] != null ? screenshotQtys[r.ndc] : (r.qty || "")} onChange={function(e) { var updated = Object.assign({}, screenshotQtys); updated[r.ndc] = e.target.value; setScreenshotQtys(updated); }} /></td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}><input style={Object.assign({}, S.inp, { width: 90, padding: "6px 8px", textAlign: "right", color: priceChanged ? "#D97706" : "#059669", background: priceChanged ? "rgba(245,158,11,0.1)" : "#F8F9FB" })} type="number" step="0.01" value={editedPrices[r.ndc] != null ? editedPrices[r.ndc] : (r.unitPrice || "")} onChange={function(e) { var updated = Object.assign({}, editedPrices); updated[r.ndc] = e.target.value; setEditedPrices(updated); }} /></td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}>{extCost ? "$" + extCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "\u2014"}</td>
                {(function() {
                  var hasAvg = r.avgCost != null && r.avgCost > 0;
                  // Scale avg cost (per base unit, e.g. per tablet) up to PO UOM (e.g. per BT100)
                  var avgPerPkg = hasAvg ? (r.uomConvFactor && r.uomConvFactor > 0 ? r.avgCost * r.uomConvFactor : r.avgCost) : null;
                  var pct = (avgPerPkg != null && avgPerPkg > 0 && editedPrice) ? ((editedPrice - avgPerPkg) / avgPerPkg) * 100 : null;
                  var isFlag = pct != null && pct >= flagThreshold;
                  var pctColor = pct == null ? "#9CA3AF" : isFlag ? "#FFFFFF" : pct >= 20 ? "#DC2626" : pct >= 10 ? "#D97706" : pct <= -10 ? "#059669" : "#6B7280";
                  var pctTdStyle = isFlag
                    ? Object.assign({}, S.td, { textAlign: "center", padding: "8px 10px" })
                    : Object.assign({}, S.td, { textAlign: "right", color: pctColor, fontWeight: pct != null && pct >= 20 ? 600 : 400 });
                  return <>
                    <td style={Object.assign({}, S.td, { textAlign: "right", color: hasAvg ? "#374151" : "#9CA3AF" })}>{avgPerPkg != null ? "$" + avgPerPkg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "\u2014"}</td>
                    <td style={pctTdStyle}>
                      {pct == null ? <span style={{ color: "#9CA3AF" }}>{"\u2014"}</span>
                        : isFlag ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#DC2626", color: "#FFFFFF", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, letterSpacing: 0.3, boxShadow: "0 1px 2px rgba(220,38,38,0.3)" }}>{"\u26A0 +" + pct.toFixed(1) + "%"}</span>
                        : <span style={{ color: pctColor, fontWeight: pct >= 20 ? 600 : 400 }}>{(pct > 0 ? "+" : "") + pct.toFixed(1) + "%"}</span>}
                    </td>
                  </>;
                })()}
                {vendor === "mckesson" && <td style={S.td}>{r.vendorItemNum || "\u2014"}</td>}
                <td style={Object.assign({}, S.td, { color: "#9CA3AF" })}>{(r.sourceFile || "").split("/").pop()}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>}

      {/* ── Acumatica auto-create: confirmation modal ──────────────────── */}
      {acuCreateConfirm && (function() {
        var posList = acuCreateConfirm.pos || [];
        var blockedList = acuCreateConfirm.blocked || [];
        var grandTotal = posList.reduce(function(s, p) { return s + (p.orderTotal || 0); }, 0);
        return <div onClick={function() { setAcuCreateConfirm(null); }} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#FFFFFF", borderRadius: 8, padding: 24, width: "min(720px, 92vw)", maxHeight: "85vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937", marginBottom: 8 }}>Create {posList.length} PO{posList.length === 1 ? "" : "s"} in Acumatica?</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>One PO per PDF will be created with Hold:false (Open) and the values shown below. Stops on first failure.</div>

            {posList.length > 0 && <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden", marginBottom: blockedList.length > 0 ? 12 : 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>File</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>Vendor</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>Description</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>Vendor Ref</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>Warehouse</th>
                  <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#6B7280" }}>Lines</th>
                  <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#6B7280" }}>Total</th>
                </tr></thead>
                <tbody>{posList.map(function(p, i) {
                  return <tr key={i} style={{ borderBottom: i < posList.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                    <td style={{ padding: "8px 10px", color: "#374151", fontSize: 11 }}>{(p.file || "").split("/").pop()}</td>
                    <td style={{ padding: "8px 10px", color: "#374151" }}>{p.vendorId}</td>
                    <td style={{ padding: "8px 10px", color: p.description ? "#374151" : "#9CA3AF", fontStyle: p.description ? "normal" : "italic" }}>{p.description || "(blank)"}</td>
                    <td style={{ padding: "8px 10px", color: "#374151", fontFamily: "monospace" }}>{p.vendorRef}</td>
                    <td style={{ padding: "8px 10px", color: "#374151" }}>{p.location}</td>
                    <td style={{ padding: "8px 10px", color: "#374151", textAlign: "right" }}>{p.lineCount}</td>
                    <td style={{ padding: "8px 10px", color: "#374151", textAlign: "right" }}>${(p.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>;
                })}</tbody>
                <tfoot><tr style={{ background: "#F9FAFB", borderTop: "1px solid #E5E7EB" }}>
                  <td colSpan={6} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#6B7280" }}>Grand total:</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#1F2937" }}>${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr></tfoot>
              </table>
            </div>}

            {blockedList.length > 0 && <div style={{ background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.15)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#DC2626", marginBottom: 6 }}>{"\u26A0"} {blockedList.length} file{blockedList.length === 1 ? "" : "s"} blocked (will not be created):</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{blockedList.map(function(b, i) {
                return <div key={i} style={{ fontSize: 11, color: "#6B7280" }}><span style={{ fontFamily: "monospace", color: "#374151" }}>{(b.file || "").split("/").pop()}</span>: {b.reason}</div>;
              })}</div>
            </div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={function() { setAcuCreateConfirm(null); }} style={Object.assign({}, S.btn("ghost"), { padding: "8px 16px" })}>Cancel</button>
              {posList.length > 0 && <button onClick={function() { executeCreatePOs(posList); }} style={{ background: "#047857", color: "#FFFFFF", border: "none", padding: "8px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Create {posList.length} PO{posList.length === 1 ? "" : "s"}</button>}
            </div>
          </div>
        </div>;
      })()}

      {/* ── Acumatica auto-create: results modal ───────────────────────── */}
      {acuCreateResult && (function() {
        var data = acuCreateResult.data || {};
        var requested = acuCreateResult.requested || [];
        var succeeded = data.succeeded || [];
        var failure = data.failure || null;
        var allOk = data.ok === true && !failure;
        var failureRequested = failure ? requested[failure.poIndex] : null;
        var notAttempted = failure ? requested.slice(failure.poIndex + 1) : [];
        return <div onClick={function() { setAcuCreateResult(null); }} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#FFFFFF", borderRadius: 8, padding: 24, width: "min(720px, 92vw)", maxHeight: "85vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: allOk ? "#047857" : "#DC2626", marginBottom: 8 }}>{allOk ? "\u2713 All POs created" : "\u26A0 Stopped on failure"}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>{succeeded.length} created, {failure ? "1 failed" : "0 failed"}{notAttempted.length > 0 ? ", " + notAttempted.length + " not attempted" : ""}</div>

            {succeeded.length > 0 && <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#047857", marginBottom: 8 }}>Created in Acumatica:</div>
              <div style={{ border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>Order Nbr</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>Vendor Ref</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#6B7280" }}>Description</th>
                    <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#6B7280" }}>Lines</th>
                    <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#6B7280" }}>Total</th>
                  </tr></thead>
                  <tbody>{succeeded.map(function(s, i) {
                    return <tr key={i} style={{ borderBottom: i < succeeded.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                      <td style={{ padding: "6px 10px", color: "#1F2937", fontWeight: 600, fontFamily: "monospace" }}>{s.orderNbr || "?"}</td>
                      <td style={{ padding: "6px 10px", color: "#374151", fontFamily: "monospace" }}>{s.vendorRef}</td>
                      <td style={{ padding: "6px 10px", color: s.description ? "#374151" : "#9CA3AF", fontStyle: s.description ? "normal" : "italic" }}>{s.description || "(blank)"}</td>
                      <td style={{ padding: "6px 10px", color: "#374151", textAlign: "right" }}>{s.lineCount}</td>
                      <td style={{ padding: "6px 10px", color: "#374151", textAlign: "right" }}>${(s.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </div>}

            {failure && <div style={{ background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#DC2626", marginBottom: 6 }}>Failed PO #{failure.poIndex + 1}:</div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 8 }}>
                <div>Vendor Ref: <span style={{ fontFamily: "monospace", color: "#374151" }}>{failure.vendorRef}</span>{failureRequested ? <> {"\u00B7"} File: <span style={{ fontFamily: "monospace", color: "#374151" }}>{(failureRequested.file || "").split("/").pop()}</span></> : null}</div>
                <div>Stage: <span style={{ color: "#374151" }}>{failure.stage}</span>{failure.status ? <> {"\u00B7"} HTTP {failure.status}</> : null}</div>
              </div>
              {failure.errorDetails && failure.errorDetails.length > 0 && <div style={{ background: "#FFFFFF", border: "1px solid #FECACA", borderRadius: 4, padding: 8, fontSize: 11, color: "#7F1D1D" }}>
                {failure.errorDetails.map(function(e, i) {
                  return <div key={i} style={{ marginBottom: i < failure.errorDetails.length - 1 ? 4 : 0 }}>{e.field ? <span style={{ fontFamily: "monospace", marginRight: 6 }}>{e.field}:</span> : null}{e.message}</div>;
                })}
              </div>}
              {(!failure.errorDetails || failure.errorDetails.length === 0) && failure.rawBody && <pre style={{ background: "#FFFFFF", border: "1px solid #FECACA", borderRadius: 4, padding: 8, fontSize: 10, color: "#7F1D1D", maxHeight: 200, overflow: "auto", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{failure.rawBody}</pre>}
            </div>}

            {notAttempted.length > 0 && <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>Not attempted ({notAttempted.length}):</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>{notAttempted.map(function(p, i) { return <span key={i} style={{ fontFamily: "monospace", marginRight: 12 }}>{p.vendorRef}</span>; })}</div>
            </div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={function() { setAcuCreateResult(null); }} style={Object.assign({}, S.btn(), { padding: "8px 16px" })}>Close</button>
            </div>
          </div>
        </div>;
      })()}
    </div>
  );
}

/* ═══════ HILLS & PAWTREE TRACKER ═══════ */
function HillsTracker(props) {
  var toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred;
  var TOOL_COLOR = "#10B981";
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _meta = useState({}), meta = _meta[0], setMeta = _meta[1];
  var _hpSort = useState({ col: "date", dir: "asc" }), hpSort = _hpSort[0], setHpSort = _hpSort[1];
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);

  // Persist ETA and Notes in KV (shared) + localStorage (cache)
  var storageKey = "hills-pawtree-meta";
  var kvMetaKey = "hills-pawtree-meta";
  var metaRef = useRef(meta);
  metaRef.current = meta;

  useEffect(function() {
    var m = true;
    (async function() {
      // Try KV first
      try {
        var resp = await kvGet(kvMetaKey);
        var json = await resp.json();
        if (m && json.data && typeof json.data === "object" && Object.keys(json.data).length > 0) {
          setMeta(json.data);
          sSet(storageKey, json.data);
          return;
        }
      } catch (e) {}
      // Fall back to localStorage
      if (m) { var saved = sGet(storageKey); if (saved) setMeta(saved); }
    })();
    return function() { m = false; };
  }, []);

  // Poll KV every 10 seconds for changes from other users
  useEffect(function() {
    var m = true;
    var poll = setInterval(async function() {
      try {
        var resp = await kvGet(kvMetaKey);
        var json = await resp.json();
        if (!m || !json.data || typeof json.data !== "object") return;
        var remote = json.data;
        if (JSON.stringify(remote) !== JSON.stringify(metaRef.current)) {
          // Merge: remote wins for fields the local user hasn't touched recently
          var merged = Object.assign({}, remote);
          setMeta(merged);
          sSet(storageKey, merged);
        }
      } catch (e) {}
    }, 10000);
    return function() { m = false; clearInterval(poll); };
  }, []);

  function updateMeta(po, field, value) {
    var updated = Object.assign({}, meta);
    if (!updated[po]) updated[po] = {};
    updated[po][field] = value;
    setMeta(updated);
    sSet(storageKey, updated);
    // Save to KV for sharing
    kvPost(kvMetaKey, updated).catch(function() {});
  }

  var fetchData = useCallback(async function() {
    if (!ok) { lp(); return; }
    setLoading(true);
    try {
      var rows = await fetchAcumatica("hills-pawtree", null, cred.username, cred.password);
      setData(rows);
      sSet("hills-pawtree-data", { rows: rows, fetchedAt: Date.now() });
      toast("Hills & Pawtree: Loaded " + rows.length + " POs");
    } catch (err) { toast("Error: " + err.message, "error"); }
    finally { setLoading(false); }
  }, [ok, lp, cred, toast]);

  useEffect(function() {
    if (!ok || !cred || !cred.username) return;
    var cached = sGet("hills-pawtree-data");
    if (cached && cached.rows && cached.rows.length > 0) {
      setData(cached.rows);
      // Check if last fetch was more than 24 hours ago
      var age = Date.now() - (cached.fetchedAt || 0);
      if (age > 24 * 60 * 60 * 1000) fetchData();
    } else {
      fetchData();
    }
  }, [ok]);

  function simplifyWarehouse(wh, vendor) {
    var w = (wh || "").trim();
    var v = (vendor || "").trim();
    if (v === "VID0040" || v.toLowerCase().indexOf("pawtree") >= 0) return "CA - Pawtree";
    if (w.indexOf("CP-CA") >= 0) return "CA";
    if (w.indexOf("CP-NJ") >= 0) return "NJ";
    if (w.indexOf("CP-FL") >= 0) return "FL";
    if (w.indexOf("CP-TX") >= 0) return "TX";
    return w.replace("HILL-", "");
  }

  function parseDate(d) {
    if (!d) return null;
    var s = String(d);
    if (s.indexOf("T") >= 0) s = s.split("T")[0];
    var parts = s.split(/[-\/]/);
    if (parts.length === 3) {
      var yr = parts[0].length === 4 ? parseInt(parts[0]) : parseInt(parts[2]);
      var mo = parts[0].length === 4 ? parseInt(parts[1]) - 1 : parseInt(parts[0]) - 1;
      var dy = parts[0].length === 4 ? parseInt(parts[2]) : parseInt(parts[1]);
      var dt = new Date(yr, mo, dy);
      if (!isNaN(dt.getTime())) return dt;
    }
    var fallback = new Date(d);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  function businessDaysSince(date) {
    if (!date) return 0;
    var now = new Date(); now.setHours(0,0,0,0);
    var d = new Date(date); d.setHours(0,0,0,0);
    if (d >= now) return 0;
    var count = 0;
    var cur = new Date(d);
    while (cur < now) {
      cur.setDate(cur.getDate() + 1);
      var day = cur.getDay();
      if (day !== 0 && day !== 6) count++;
    }
    return count;
  }

  function isDatePast(dateStr) {
    var d = parseDate(dateStr);
    if (!d) return false;
    var now = new Date(); now.setHours(0,0,0,0);
    return d < now;
  }

  function formatDate(d) {
    var dt = parseDate(d);
    if (!dt) return "";
    return (dt.getMonth() + 1) + "/" + dt.getDate() + "/" + dt.getFullYear();
  }

  // Sort: NJ first, then CA, then CA - Pawtree
  var sorted = useMemo(function() {
    var arr = data.slice();
    if (hpSort.col === "date") {
      arr.sort(function(a, b) { var da = parseDate(a.DateOrdered) || new Date(0); var db = parseDate(b.DateOrdered) || new Date(0); return hpSort.dir === "desc" ? db - da : da - db; });
    } else if (hpSort.col === "po") {
      arr.sort(function(a, b) { return hpSort.dir === "desc" ? (b.PONumber || "").localeCompare(a.PONumber || "") : (a.PONumber || "").localeCompare(b.PONumber || ""); });
    } else if (hpSort.col === "wh") {
      arr.sort(function(a, b) { var wa = simplifyWarehouse(a.Warehouse, a.Vendor); var wb = simplifyWarehouse(b.Warehouse, b.Vendor); return hpSort.dir === "desc" ? wb.localeCompare(wa) : wa.localeCompare(wb); });
    } else {
      arr.sort(function(a, b) { var wa = simplifyWarehouse(a.Warehouse, a.Vendor); var wb = simplifyWarehouse(b.Warehouse, b.Vendor); var order = { "NJ": 0, "CA": 1, "FL": 2, "TX": 3, "CA - Pawtree": 4 }; var oa = order[wa] != null ? order[wa] : 5; var ob = order[wb] != null ? order[wb] : 5; if (oa !== ob) return oa - ob; return (a.PONumber || "").localeCompare(b.PONumber || ""); });
    }
    return arr;
  }, [data, hpSort]);

  var stats = useMemo(function() {
    var total = data.length;
    var overdue = data.filter(function(r) { return businessDaysSince(parseDate(r.DateOrdered)) >= 14; }).length;
    var withEta = data.filter(function(r) { return meta[r.PONumber] && meta[r.PONumber].eta; }).length;
    var pastEta = data.filter(function(r) { var m = meta[r.PONumber]; return m && m.eta && isDatePast(m.eta); }).length;
    return { total: total, overdue: overdue, withEta: withEta, pastEta: pastEta };
  }, [data, meta]);

  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
      <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 20px" })} onClick={fetchData} disabled={loading}>{loading ? <><Spinner /> Fetching...</> : <><IconRefresh /> {data.length > 0 ? "Refresh" : "Load Data"}</>}</Gate>
      {data.length > 0 && <span style={{ fontSize: 12, color: "#6B7280" }}>{data.length} open POs</span>}
      {data.length > 0 && (function() { var cached = sGet("hills-pawtree-data"); if (cached && cached.fetchedAt) { var d = new Date(cached.fetchedAt); return <span style={{ fontSize: 11, color: "#9CA3AF" }}>Last refreshed: {d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>; } return null; })()}
    </div>

    {data.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
      <div style={Object.assign({}, S.statCard, { background: "#EEF4FF" })}><div style={{ fontSize: 11, color: "#6B8ABF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Open POs</div><div style={{ fontSize: 28, fontWeight: 500, color: "#2563EB", marginTop: 6 }}>{stats.total}</div></div>
      <div style={Object.assign({}, S.statCard, { background: stats.overdue > 0 ? "#FEF2F2" : "#ECFDF5" })}><div style={{ fontSize: 11, color: stats.overdue > 0 ? "#C47070" : "#6B9E8A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Overdue (14+ days)</div><div style={{ fontSize: 28, fontWeight: 500, color: stats.overdue > 0 ? "#DC2626" : "#059669", marginTop: 6 }}>{stats.overdue}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#FEF7EC" })}><div style={{ fontSize: 11, color: "#B08A4A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>ETA Set</div><div style={{ fontSize: 28, fontWeight: 500, color: "#D97706", marginTop: 6 }}>{stats.withEta}</div></div>
      <div style={Object.assign({}, S.statCard, { background: stats.pastEta > 0 ? "#FEF2F2" : "#ECFDF5" })}><div style={{ fontSize: 11, color: stats.pastEta > 0 ? "#C47070" : "#6B9E8A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Past ETA</div><div style={{ fontSize: 28, fontWeight: 500, color: stats.pastEta > 0 ? "#DC2626" : "#059669", marginTop: 6 }}>{stats.pastEta}</div></div>
    </div>}

    {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
        <thead><tr>
          <th onClick={function() { setHpSort(hpSort.col === "po" ? { col: "po", dir: hpSort.dir === "desc" ? "asc" : "desc" } : { col: "po", dir: "asc" }); }} style={Object.assign({}, S.th, { cursor: "pointer", userSelect: "none" })}>PO{hpSort.col === "po" ? (hpSort.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>
          <th onClick={function() { setHpSort(hpSort.col === "wh" ? { col: "wh", dir: hpSort.dir === "desc" ? "asc" : "desc" } : { col: "wh", dir: "asc" }); }} style={Object.assign({}, S.th, { cursor: "pointer", userSelect: "none" })}>Warehouse{hpSort.col === "wh" ? (hpSort.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>
          <th onClick={function() { setHpSort(hpSort.col === "date" ? { col: "date", dir: hpSort.dir === "desc" ? "asc" : "desc" } : { col: "date", dir: "desc" }); }} style={Object.assign({}, S.th, { cursor: "pointer", userSelect: "none" })}>PO Order Date{hpSort.col === "date" ? (hpSort.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>
          <th style={Object.assign({}, S.th, { minWidth: 140 })}>PO ETA</th>
          <th style={Object.assign({}, S.th, { minWidth: 200 })}>Notes</th>
        </tr></thead>
        <tbody>{sorted.map(function(r, i) {
          var po = r.PONumber || "";
          var wh = simplifyWarehouse(r.Warehouse, r.Vendor);
          var orderedDate = parseDate(r.DateOrdered);
          var bDays = businessDaysSince(orderedDate);
          var isOverdue = bDays >= 14;
          var poMeta = meta[po] || {};
          var etaPast = poMeta.eta && isDatePast(poMeta.eta);

          return <tr key={i}>
            <td style={Object.assign({}, S.td, { fontWeight: 600, color: "#1F2937" })}>{po}</td>
            <td style={S.td}><span style={Object.assign({}, S.badge(wh === "NJ" ? "blue" : wh === "FL" ? "danger" : wh === "TX" ? "success" : wh.indexOf("Pawtree") >= 0 ? "purple" : "default"))}>{wh}</span></td>
            <td style={Object.assign({}, S.td, { position: "relative" })}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: isOverdue ? "#DC2626" : "#374151" }}>{formatDate(r.DateOrdered)}</span>
                {isOverdue && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#FEF2F2", color: "#DC2626", fontWeight: 600 }}>{bDays}d overdue</span>}
              </div>
            </td>
            <td style={S.td}>
              <input type="text" value={poMeta.eta || ""} onChange={function(e) { updateMeta(po, "eta", e.target.value); }} placeholder="mm/dd/yyyy" style={Object.assign({}, S.inp, { padding: "6px 10px", background: etaPast ? "rgba(220,38,38,0.06)" : "#F9FAFB", borderColor: etaPast ? "rgba(220,38,38,0.3)" : "#E5E7EB", color: etaPast ? "#DC2626" : "#374151" })} />
              {etaPast && <div style={{ fontSize: 10, color: "#DC2626", marginTop: 2, fontWeight: 500 }}>Should be delivered</div>}
            </td>
            <td style={S.td}>
              <input type="text" value={poMeta.notes || ""} onChange={function(e) { updateMeta(po, "notes", e.target.value); }} placeholder="Add notes..." style={Object.assign({}, S.inp, { padding: "6px 10px" })} />
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div> : !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}>Click <strong>Load Data</strong> to fetch open Hills & Pawtree POs from Acumatica.</div>}
  </div>;
}

/* ═══════ FUZE TRACKER ═══════ */
function FuzeTracker(props) {
  var toast = props.toast, cred = props.cred;
  var TOOL_COLOR = "#F59E0B";
  var _wh = useState("TP-NY"), whTab = _wh[0], setWhTab = _wh[1];
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _q = useState(""), search = _q[0], setSearch = _q[1];
  var _vf = useState("all"), vendorFilter = _vf[0], setVendorFilter = _vf[1];
  var _sf = useState("all"), statusFilter = _sf[0], setStatusFilter = _sf[1];
  var _idMap = useState({}), invIdMap = _idMap[0], setInvIdMap = _idMap[1];
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);

  function normalizeNdc(s) { return (s || "").replace(/\D/g, ""); }

  useEffect(function() {
    if (!cred || !cred.username || !cred.password) return;
    var m = true;
    var crossRefP = fetch("/api/acumatica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "stock-cross-ref", username: cred.username, password: cred.password }),
    }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    var ndcLookupP = fetch("/api/acumatica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ndc-lookup", username: cred.username, password: cred.password }),
    }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    Promise.all([crossRefP, ndcLookupP]).then(function(both) {
      if (!m) return;
      var map = {};
      if (both[0] && both[0].data) {
        both[0].data.forEach(function(row) {
          var ndc = normalizeNdc(row.NDC);
          var invId = (row.InventoryID || "").trim();
          if (ndc && invId && !map[ndc]) map[ndc] = invId;
        });
      }
      if (both[1] && both[1].data) {
        both[1].data.forEach(function(row) {
          var ndc = normalizeNdc(row.AlternateID);
          var invId = (row.InventoryID || "").trim();
          if (ndc && invId && !map[ndc]) map[ndc] = invId;
        });
      }
      setInvIdMap(map);
    });
    return function() { m = false; };
  }, [cred]);

  var _lastFetched = useState(null), lastFetched = _lastFetched[0], setLastFetched = _lastFetched[1];
  var fetchSheet = useCallback(function(wh, silent) {
    if (!silent) setLoading(true);
    fetch("/api/sheets?wh=" + encodeURIComponent(wh) + "&_t=" + Date.now(), { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.error) { if (!silent) toast(json.error, "error"); setData([]); }
        else {
          setData(json.data || []);
          setLastFetched(Date.now());
          if (!silent) toast("Loaded " + (json.count || 0) + " items for " + wh);
          kvPost("fuze-tracker-" + wh, { data: json.data || [], fetchedAt: Date.now() }).catch(function() {});
        }
      })
      .catch(function(err) { if (!silent) toast("Error: " + err.message, "error"); })
      .finally(function() { setLoading(false); });
  }, [toast]);

  function getTodayReset() {
    var now = new Date();
    var et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    var reset = new Date(et); reset.setHours(5, 0, 0, 0);
    if (et < reset) reset.setDate(reset.getDate() - 1);
    return reset.getTime();
  }

  useEffect(function() {
    var m = true;
    kvGet("fuze-tracker-" + whTab).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m) return;
      if (d && d.data && d.data.data && d.data.data.length > 0) {
        setData(d.data.data);
        var resetTime = getTodayReset();
        if (d.data.fetchedAt && d.data.fetchedAt < resetTime) {
          fetchSheet(whTab, true);
        }
      } else {
        fetchSheet(whTab);
      }
    }).catch(function() { if (m) fetchSheet(whTab); });
    return function() { m = false; };
  }, [whTab]);

  var uniqueVendors = useMemo(function() { return Array.from(new Set(data.map(function(r) { return r["Supplier"]; }).filter(Boolean))).sort(); }, [data]);

  var filtered = useMemo(function() {
    var d = data.slice();
    if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return (r["Supplier"] || "").toLowerCase().indexOf(s) >= 0 || (r["NDC"] || "").toLowerCase().indexOf(s) >= 0 || (r["Product Description"] || "").toLowerCase().indexOf(s) >= 0 || (r["PO No."] || "").toLowerCase().indexOf(s) >= 0 || (r["Tracking #"] || "").toLowerCase().indexOf(s) >= 0; }); }
    if (vendorFilter !== "all") d = d.filter(function(r) { return r["Supplier"] === vendorFilter; });
    if (statusFilter === "pending") d = d.filter(function(r) { return r["Received?**"] !== "TRUE" && r["Received?**"] !== "true"; });
    if (statusFilter === "received") d = d.filter(function(r) { return r["Received?**"] === "TRUE" || r["Received?**"] === "true"; });
    if (statusFilter === "landed") d = d.filter(function(r) { return r["Landed Onsite?"] === "TRUE" || r["Landed Onsite?"] === "true"; });
    return d;
  }, [data, search, vendorFilter, statusFilter]);

  var stats = useMemo(function() {
    var total = data.length;
    var received = data.filter(function(r) { return r["Received?**"] === "TRUE" || r["Received?**"] === "true"; }).length;
    var landed = data.filter(function(r) { return r["Landed Onsite?"] === "TRUE" || r["Landed Onsite?"] === "true"; }).length;
    var pending = total - received;
    return { total: total, received: received, landed: landed, pending: pending };
  }, [data]);

  var whTabs = [{ id: "TP-NY", label: "Brooklyn" }, { id: "TP-OH", label: "Seven Hills" }, { id: "TP-CA", label: "Hayward" }];

  return <div>
    {/* Warehouse tabs */}
    <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#FFFFFF", borderRadius: 10, padding: 3, width: "fit-content", border: "0.5px solid #E5E7EB" }}>
      {whTabs.map(function(t) { return <button key={t.id} onClick={function() { setWhTab(t.id); setSearch(""); setVendorFilter("all"); setStatusFilter("all"); }} style={S.pill(whTab === t.id, TOOL_COLOR)}>{t.label}{whTab === t.id && data.length > 0 && <span style={{ fontSize: 10, background: "rgba(255,255,255,0.25)", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>{data.length}</span>}</button>; })}
    </div>

    {/* Stat cards */}
    {data.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
      <div style={Object.assign({}, S.statCard, { background: "#EEF4FF" })}><div style={{ fontSize: 11, color: "#6B8ABF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Items</div><div style={{ fontSize: 28, fontWeight: 500, color: "#2563EB", marginTop: 6 }}>{stats.total}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#FEF7EC" })}><div style={{ fontSize: 11, color: "#B08A4A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Pending</div><div style={{ fontSize: 28, fontWeight: 500, color: "#D97706", marginTop: 6 }}>{stats.pending}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#F0FDF4" })}><div style={{ fontSize: 11, color: "#6B9E8A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Received</div><div style={{ fontSize: 28, fontWeight: 500, color: "#059669", marginTop: 6 }}>{stats.received}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#EEF4FF" })}><div style={{ fontSize: 11, color: "#6B8ABF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Landed</div><div style={{ fontSize: 28, fontWeight: 500, color: "#3B82F6", marginTop: 6 }}>{stats.landed}</div></div>
    </div>}

    {/* Toolbar */}
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      <input style={Object.assign({}, S.inp, { maxWidth: 220 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
      <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Suppliers</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
      <select style={S.sel} value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }}>
        <option value="all">All Statuses</option>
        <option value="pending">Pending</option>
        <option value="received">Received</option>
        <option value="landed">Landed</option>
      </select>
      <div style={{ flex: 1 }} />
      <CacheStatus lastFetchedAt={lastFetched} cacheHit={false} refreshing={loading} color={TOOL_COLOR} onRefresh={function() { fetchSheet(whTab); }} />
      <span style={{ fontSize: 12, color: "#6B7280" }}>{filtered.length}/{data.length}</span>
    </div>

    {/* Table */}
    {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 320px)" })}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
        <thead><tr>
          <th style={S.th}>Supplier</th>
          <th style={S.th}>NDC</th>
          <th style={Object.assign({}, S.th, { minWidth: 200 })}>Product Description</th>
          <th style={S.th}>Inventory ID</th>
          <th style={Object.assign({}, S.th, { textAlign: "right" })}>Pkg Qty</th>
          <th style={Object.assign({}, S.th, { textAlign: "right" })}>Expected BOH</th>
          <th style={S.th}>PO No.</th>
          <th style={S.th}>Order Date</th>
          <th style={S.th}>Expected Arrival</th>
          <th style={S.th}>Tracking #</th>
          <th style={S.th}>Received</th>
          <th style={S.th}>Landed</th>
        </tr></thead>
        <tbody>{filtered.map(function(r, i) {
          var isReceived = r["Received?**"] === "TRUE" || r["Received?**"] === "true";
          var isLanded = r["Landed Onsite?"] === "TRUE" || r["Landed Onsite?"] === "true";
          var invId = invIdMap[normalizeNdc(r["NDC"])] || "";
          return <tr key={i}>
            <td style={Object.assign({}, S.td, { color: "#1F2937", fontWeight: 500 })}>{r["Supplier"]}</td>
            <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" })}>{r["NDC"]}</td>
            <td style={S.td}>{r["Product Description"]}</td>
            <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, color: invId ? "#D97706" : "#9CA3AF", fontWeight: 600 })}>{invId || "\u2014"}</td>
            <td style={Object.assign({}, S.td, { textAlign: "right" })}>{r["Pkg Qty"]}</td>
            <td style={Object.assign({}, S.td, { textAlign: "right" })}>{r["Expected BOH Increase"]}</td>
            <td style={S.td}>{r["PO No."]}</td>
            <td style={Object.assign({}, S.td, { whiteSpace: "nowrap" })}>{r["Order Date"]}</td>
            <td style={Object.assign({}, S.td, { whiteSpace: "nowrap" })}>{r["Expected Arrival"]}</td>
            <td style={Object.assign({}, S.td, { fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{r["Tracking #"]}</td>
            <td style={Object.assign({}, S.td, { textAlign: "center" })}><span style={S.badge(isReceived ? "success" : "warning")}>{isReceived ? "Yes" : "No"}</span></td>
            <td style={Object.assign({}, S.td, { textAlign: "center" })}><span style={S.badge(isLanded ? "success" : "default")}>{isLanded ? "Yes" : "No"}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}>{loading ? <Spinner color={TOOL_COLOR} size={20} /> : "No data loaded. Check that the sheet URLs are configured."}</div>}
  </div>;
}

/* ═══════ GGM TRACKER ═══════ */
function GGMTracker(props) {
  var toast = props.toast, cred = props.cred;
  var TOOL_COLOR = "#8B5CF6";
  var _wh = useState("GGM-KY"), whTab = _wh[0], setWhTab = _wh[1];
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _q = useState(""), search = _q[0], setSearch = _q[1];
  var _vf = useState("all"), vendorFilter = _vf[0], setVendorFilter = _vf[1];
  var _sf = useState("all"), statusFilter = _sf[0], setStatusFilter = _sf[1];
  var _idMap = useState({}), invIdMap = _idMap[0], setInvIdMap = _idMap[1];
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);

  function normalizeNdc(s) { return (s || "").replace(/\D/g, ""); }

  useEffect(function() {
    if (!cred || !cred.username || !cred.password) return;
    var m = true;
    var crossRefP = fetch("/api/acumatica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "stock-cross-ref", username: cred.username, password: cred.password }),
    }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    var ndcLookupP = fetch("/api/acumatica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ndc-lookup", username: cred.username, password: cred.password }),
    }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    Promise.all([crossRefP, ndcLookupP]).then(function(both) {
      if (!m) return;
      var map = {};
      if (both[0] && both[0].data) {
        both[0].data.forEach(function(row) {
          var ndc = normalizeNdc(row.NDC);
          var invId = (row.InventoryID || "").trim();
          if (ndc && invId && !map[ndc]) map[ndc] = invId;
        });
      }
      if (both[1] && both[1].data) {
        both[1].data.forEach(function(row) {
          var ndc = normalizeNdc(row.AlternateID);
          var invId = (row.InventoryID || "").trim();
          if (ndc && invId && !map[ndc]) map[ndc] = invId;
        });
      }
      setInvIdMap(map);
    });
    return function() { m = false; };
  }, [cred]);

  var _lastFetched = useState(null), lastFetched = _lastFetched[0], setLastFetched = _lastFetched[1];
  var fetchSheet = useCallback(function(wh, silent) {
    if (!silent) setLoading(true);
    fetch("/api/sheets?wh=" + encodeURIComponent(wh) + "&_t=" + Date.now(), { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.error) { if (!silent) toast(json.error, "error"); setData([]); }
        else {
          setData(json.data || []);
          setLastFetched(Date.now());
          if (!silent) toast("Loaded " + (json.count || 0) + " items for " + wh);
          kvPost("ggm-tracker-" + wh, { data: json.data || [], fetchedAt: Date.now() }).catch(function() {});
        }
      })
      .catch(function(err) { if (!silent) toast("Error: " + err.message, "error"); })
      .finally(function() { setLoading(false); });
  }, [toast]);

  function getTodayReset() {
    var now = new Date();
    var et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    var reset = new Date(et); reset.setHours(5, 0, 0, 0);
    if (et < reset) reset.setDate(reset.getDate() - 1);
    return reset.getTime();
  }

  useEffect(function() {
    var m = true;
    kvGet("ggm-tracker-" + whTab).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m) return;
      if (d && d.data && d.data.data && d.data.data.length > 0) {
        setData(d.data.data);
        var resetTime = getTodayReset();
        if (d.data.fetchedAt && d.data.fetchedAt < resetTime) {
          fetchSheet(whTab, true);
        }
      } else {
        fetchSheet(whTab);
      }
    }).catch(function() { if (m) fetchSheet(whTab); });
    return function() { m = false; };
  }, [whTab]);

  var uniqueVendors = useMemo(function() { return Array.from(new Set(data.map(function(r) { return r["Manufacturer"]; }).filter(Boolean))).sort(); }, [data]);

  var filtered = useMemo(function() {
    var d = data.slice();
    if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return (r["Manufacturer"] || "").toLowerCase().indexOf(s) >= 0 || (r["NDC"] || "").toLowerCase().indexOf(s) >= 0 || (r["Product Description"] || "").toLowerCase().indexOf(s) >= 0 || (r["PO Number"] || "").toLowerCase().indexOf(s) >= 0 || (r["Tracking #"] || "").toLowerCase().indexOf(s) >= 0; }); }
    if (vendorFilter !== "all") d = d.filter(function(r) { return r["Manufacturer"] === vendorFilter; });
    if (statusFilter === "pending") d = d.filter(function(r) { return r["Received?"] !== "TRUE" && r["Received?"] !== "true"; });
    if (statusFilter === "received") d = d.filter(function(r) { return r["Received?"] === "TRUE" || r["Received?"] === "true"; });
    return d;
  }, [data, search, vendorFilter, statusFilter]);

  var stats = useMemo(function() {
    var total = data.length;
    var received = data.filter(function(r) { return r["Received?"] === "TRUE" || r["Received?"] === "true"; }).length;
    var pending = total - received;
    return { total: total, received: received, pending: pending };
  }, [data]);

  var whTabs = [{ id: "GGM-KY", label: "Kentucky" }, { id: "GGM-AZ", label: "Arizona" }];

  return <div>
    {/* Warehouse tabs */}
    <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#FFFFFF", borderRadius: 10, padding: 3, width: "fit-content", border: "0.5px solid #E5E7EB" }}>
      {whTabs.map(function(t) { return <button key={t.id} onClick={function() { setWhTab(t.id); setSearch(""); setVendorFilter("all"); setStatusFilter("all"); }} style={S.pill(whTab === t.id, TOOL_COLOR)}>{t.label}{whTab === t.id && data.length > 0 && <span style={{ fontSize: 10, background: "rgba(255,255,255,0.25)", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>{data.length}</span>}</button>; })}
    </div>

    {/* Stat cards */}
    {data.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
      <div style={Object.assign({}, S.statCard, { background: "#EEF4FF" })}><div style={{ fontSize: 11, color: "#6B8ABF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Items</div><div style={{ fontSize: 28, fontWeight: 500, color: "#2563EB", marginTop: 6 }}>{stats.total}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#FEF7EC" })}><div style={{ fontSize: 11, color: "#B08A4A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Pending</div><div style={{ fontSize: 28, fontWeight: 500, color: "#D97706", marginTop: 6 }}>{stats.pending}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#F0FDF4" })}><div style={{ fontSize: 11, color: "#6B9E8A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Received</div><div style={{ fontSize: 28, fontWeight: 500, color: "#059669", marginTop: 6 }}>{stats.received}</div></div>
    </div>}

    {/* Toolbar */}
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      <input style={Object.assign({}, S.inp, { maxWidth: 220 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
      <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Manufacturers</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
      <select style={S.sel} value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }}>
        <option value="all">All Statuses</option>
        <option value="pending">Pending</option>
        <option value="received">Received</option>
      </select>
      <div style={{ flex: 1 }} />
      <CacheStatus lastFetchedAt={lastFetched} cacheHit={false} refreshing={loading} color={TOOL_COLOR} onRefresh={function() { fetchSheet(whTab); }} />
      <span style={{ fontSize: 12, color: "#6B7280" }}>{filtered.length}/{data.length}</span>
    </div>

    {/* Table */}
    {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 320px)" })}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
        <thead><tr>
          <th style={S.th}>Manufacturer</th>
          <th style={S.th}>NDC</th>
          <th style={Object.assign({}, S.th, { minWidth: 200 })}>Product Description</th>
          <th style={S.th}>Inventory ID</th>
          <th style={Object.assign({}, S.th, { textAlign: "right" })}>Pkg Qty</th>
          <th style={Object.assign({}, S.th, { textAlign: "right" })}>Expected BOH</th>
          <th style={S.th}>PO Number</th>
          <th style={S.th}>Order Date</th>
          <th style={S.th}>Expected Arrival</th>
          <th style={S.th}>Tracking #</th>
          <th style={S.th}>Received</th>
        </tr></thead>
        <tbody>{filtered.map(function(r, i) {
          var isReceived = r["Received?"] === "TRUE" || r["Received?"] === "true";
          var invId = invIdMap[normalizeNdc(r["NDC"])] || r["Inventory ID"] || "";
          return <tr key={i}>
            <td style={Object.assign({}, S.td, { color: "#1F2937", fontWeight: 500 })}>{r["Manufacturer"]}</td>
            <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" })}>{r["NDC"]}</td>
            <td style={S.td}>{r["Product Description"]}</td>
            <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, color: invId ? "#7C3AED" : "#9CA3AF", fontWeight: 600 })}>{invId || "\u2014"}</td>
            <td style={Object.assign({}, S.td, { textAlign: "right" })}>{r["Pkg Qty"]}</td>
            <td style={Object.assign({}, S.td, { textAlign: "right" })}>{r["Expected BOH Increase"]}</td>
            <td style={S.td}>{r["PO Number"]}</td>
            <td style={Object.assign({}, S.td, { whiteSpace: "nowrap" })}>{r["Order Date"]}</td>
            <td style={Object.assign({}, S.td, { whiteSpace: "nowrap" })}>{r["Expected Arrival"]}</td>
            <td style={Object.assign({}, S.td, { fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{r["Tracking #"]}</td>
            <td style={Object.assign({}, S.td, { textAlign: "center" })}><span style={S.badge(isReceived ? "success" : "warning")}>{isReceived ? "Yes" : "No"}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}>{loading ? <Spinner color={TOOL_COLOR} size={20} /> : "No data loaded. Check that the sheet URLs are configured."}</div>}
  </div>;
}

/* ═══════ HOW-TO GUIDE ═══════ */
function HowToGuide(props) {
  var toast = props.toast;
  var TOOL_COLOR = "#6B7280";
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);
  var _open = useState(null), openSection = _open[0], setOpen = _open[1];

  function toggle(id) { setOpen(openSection === id ? null : id); }

  function Section(p) {
    var isOpen = openSection === p.id;
    return <div style={Object.assign({}, S.card, { padding: 0, overflow: "hidden", marginBottom: 12 })}>
      <div onClick={function() { toggle(p.id); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", cursor: "pointer", background: isOpen ? "var(--color-background-secondary)" : "transparent" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>{p.title}</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
      </div>
      {isOpen && <div style={{ padding: "0 20px 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{p.children}</div>}
    </div>;
  }

  function Step(p) {
    return <div style={{ display: "flex", gap: 10, margin: "10px 0" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: p.color || "#E5E7EB", color: p.color ? "#fff" : "#6B7280", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0, marginTop: 1 }}>{p.n}</div>
      <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{p.children}</div>
    </div>;
  }

  function Note(p) {
    return <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "10px 14px", margin: "10px 0", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{p.children}</div>;
  }

  function TruckloaderWalkthrough() {
    var _wt = useState(0), wtStep = _wt[0], setWtStep = _wt[1];
    var wtS = { card: { background: "var(--color-background-secondary)", borderRadius: 8, padding: 12, margin: "8px 0" }, label: { fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500, marginBottom: 6 }, formula: { background: "var(--color-background-primary)", borderRadius: 8, padding: "12px 16px", margin: "8px 0", fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.8, border: "0.5px solid var(--color-border-tertiary)" }, tbl: { width: "100%", borderCollapse: "collapse", fontSize: 11, margin: "6px 0" }, th: { padding: "5px 8px", textAlign: "left", background: "var(--color-background-secondary)", color: "var(--color-text-secondary)", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.3px", borderBottom: "0.5px solid var(--color-border-tertiary)" }, td: { padding: "5px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-primary)", fontSize: 11 }, badge: function(bg, color, text) { return <span style={{ background: bg, color: color, padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 500 }}>{text}</span>; } };

    var wtTabs = [
      { t: "Data sources", c: function() { return <div>
        <div style={wtS.card}><div style={wtS.label}>Three systems feed the truckloader</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140, background: "#E1F5EE", borderRadius: 8, padding: "8px 10px", border: "0.5px solid #0F6E56" }}><div style={{ fontSize: 12, fontWeight: 500, color: "#085041" }}>Acumatica (live)</div><div style={{ fontSize: 11, color: "#0F6E56", marginTop: 3 }}>Replenishment needs GI: what items are below reorder point, qty available, qty on PO, max qty. Also Whse Replenish for replenishment classes (A/B/C).</div></div>
            <div style={{ flex: 1, minWidth: 140, background: "#FAEEDA", borderRadius: 8, padding: "8px 10px", border: "0.5px solid #854F0B" }}><div style={{ fontSize: 12, fontWeight: 500, color: "#633806" }}>Hills Master (upload)</div><div style={{ fontSize: 11, color: "#854F0B", marginTop: 3 }}>Manufacturer spreadsheet with pallet weights, cases per pallet. Uploaded once, stored in cloud (KV). Re-upload only when Hill's sends a new version.</div></div>
            <div style={{ flex: 1, minWidth: 140, background: "#FAECE7", borderRadius: 8, padding: "8px 10px", border: "0.5px solid #993C1D" }}><div style={{ fontSize: 12, fontWeight: 500, color: "#712B13" }}>Netstock DOH (upload)</div><div style={{ fontSize: 11, color: "#993C1D", marginTop: 3 }}>Days on hand, sales velocity, on-hand quantities. Used only for fill suggestions. Uploaded each session, not stored.</div></div>
          </div>
        </div></div>; }
      },
      { t: "The GI query", c: function() { return <div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>A custom query in Acumatica that joins three database tables:</div>
        <div style={{ background: "var(--color-background-primary)", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}>
          <table style={wtS.tbl}><thead><tr><th style={wtS.th}>Table</th><th style={wtS.th}>What it holds</th><th style={wtS.th}>Key fields</th></tr></thead>
          <tbody>
            <tr><td style={wtS.td}>INItemSite</td><td style={wtS.td}>Per-warehouse item settings</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>MinQty (reorder pt), MaxQty, SafetyStock</td></tr>
            <tr><td style={wtS.td}>INSiteStatus</td><td style={wtS.td}>Live inventory levels</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>QtyAvail, QtyPOOrders, QtySOBooked</td></tr>
            <tr><td style={wtS.td}>InventoryItem</td><td style={wtS.td}>Item master</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>InventoryCD, Description, ItemStatus</td></tr>
          </tbody></table>
        </div>
        <div style={wtS.formula}><span style={{ color: "#534AB7", fontWeight: 500 }}>(</span> QtyAvail <span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u2264"}</span> MinQty <span style={{ color: "#534AB7", fontWeight: 500 }}>AND</span> MinQty <span style={{ color: "#534AB7", fontWeight: 500 }}>{">"}</span> 0 <span style={{ color: "#534AB7", fontWeight: 500 }}>)</span><br /><span style={{ color: "#534AB7", fontWeight: 500 }}>AND</span> ItemStatus <span style={{ color: "#534AB7", fontWeight: 500 }}>=</span> <span style={{ color: "#0F6E56", fontWeight: 500 }}>Active</span><br /><span style={{ color: "#534AB7", fontWeight: 500 }}>AND (</span> SiteID <span style={{ color: "#534AB7", fontWeight: 500 }}>=</span> <span style={{ color: "#0F6E56", fontWeight: 500 }}>HILL-CP-CA</span> <span style={{ color: "#534AB7", fontWeight: 500 }}>OR</span> SiteID <span style={{ color: "#534AB7", fontWeight: 500 }}>=</span> <span style={{ color: "#0F6E56", fontWeight: 500 }}>HILL-CP-NJ</span> <span style={{ color: "#534AB7", fontWeight: 500 }}>)</span></div>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Returns ~66 items below reorder point. Exposed via OData so the website can call it as an API.</div>
      </div>; }
      },
      { t: "Client filter", c: function() { return <div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>The GI returns all items below reorder, but Prepare Replenishment also factors in stock on PO. The website applies this filter:</div>
        <div style={wtS.formula}><span style={{ color: "#534AB7", fontWeight: 500 }}>Show item if:</span> QtyAvail <span style={{ color: "#534AB7", fontWeight: 500 }}>+</span> OnPO <span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u2264"}</span> ReorderPoint</div>
        <div style={{ background: "var(--color-background-primary)", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}>
          <table style={wtS.tbl}><thead><tr><th style={wtS.th}>Item</th><th style={Object.assign({}, wtS.th, { textAlign: "right" })}>Qty avail</th><th style={Object.assign({}, wtS.th, { textAlign: "right" })}>On PO</th><th style={Object.assign({}, wtS.th, { textAlign: "right" })}>Projected</th><th style={Object.assign({}, wtS.th, { textAlign: "right" })}>Reorder pt</th><th style={wtS.th}>Show?</th></tr></thead>
          <tbody>
            <tr><td style={Object.assign({}, wtS.td, { fontFamily: "monospace" })}>8694</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>190</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>288</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>478</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>502</td><td style={Object.assign({}, wtS.td, { color: "#059669", fontWeight: 500 })}>Yes (478 {"\u2264"} 502)</td></tr>
            <tr><td style={Object.assign({}, wtS.td, { fontFamily: "monospace" })}>10013</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>254</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>520</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>774</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>459</td><td style={Object.assign({}, wtS.td, { color: "#DC2626", fontWeight: 500 })}>No (774 {">"} 459)</td></tr>
          </tbody></table>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 6 }}>This reduces ~66 GI items to ~37 that genuinely need ordering, matching Prepare Replenishment exactly.</div>
      </div>; }
      },
      { t: "Order calc", c: function() { return <div>
        <div style={wtS.formula}><span style={{ color: "#534AB7", fontWeight: 500 }}>Case need</span> = MaxQty <span style={{ color: "#534AB7", fontWeight: 500 }}>-</span> QtyAvail <span style={{ color: "#534AB7", fontWeight: 500 }}>-</span> OnPO<br /><span style={{ color: "#534AB7", fontWeight: 500 }}>Pallets</span> = <span style={{ color: "#534AB7", fontWeight: 500 }}>ceil(</span> CaseNeed <span style={{ color: "#534AB7", fontWeight: 500 }}>/</span> CasesPerPallet <span style={{ color: "#534AB7", fontWeight: 500 }}>)</span><br /><span style={{ color: "#534AB7", fontWeight: 500 }}>Order qty</span> = Pallets <span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u00D7"}</span> CasesPerPallet<br /><span style={{ color: "#534AB7", fontWeight: 500 }}>Total lbs</span> = Pallets <span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u00D7"}</span> PalletWeight</div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>Worked example for item 8694 at HILL-CP-NJ:</div>
        <div style={{ background: "var(--color-background-primary)", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}>
          <table style={wtS.tbl}><thead><tr><th style={wtS.th}>Field</th><th style={wtS.th}>Source</th><th style={Object.assign({}, wtS.th, { textAlign: "right" })}>Value</th></tr></thead>
          <tbody>
            <tr><td style={wtS.td}>Max qty</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>Acumatica GI</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>994</td></tr>
            <tr><td style={wtS.td}>Qty available</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>Acumatica GI</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>190</td></tr>
            <tr><td style={wtS.td}>On PO</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>Acumatica GI</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>228</td></tr>
            <tr><td style={wtS.td}>Case need</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>994 - 190 - 228</td><td style={Object.assign({}, wtS.td, { textAlign: "right", color: "#D97706", fontWeight: 500 })}>576</td></tr>
            <tr><td style={wtS.td}>Cases/pallet</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>Hills Master</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>96</td></tr>
            <tr><td style={wtS.td}>Pallets</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>ceil(576 / 96)</td><td style={Object.assign({}, wtS.td, { textAlign: "right", color: "#D97706", fontWeight: 500 })}>6</td></tr>
            <tr><td style={wtS.td}>Order qty</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>6 {"\u00D7"} 96</td><td style={Object.assign({}, wtS.td, { textAlign: "right", color: "#059669", fontWeight: 600 })}>576</td></tr>
            <tr><td style={wtS.td}>Total lbs</td><td style={Object.assign({}, wtS.td, { fontFamily: "monospace", fontSize: 10 })}>6 {"\u00D7"} 866.9</td><td style={Object.assign({}, wtS.td, { textAlign: "right", color: "#059669", fontWeight: 600 })}>5,201</td></tr>
          </tbody></table>
        </div>
      </div>; }
      },
      { t: "Truck optimizer", c: function() { return <div>
        <div style={wtS.formula}>1. Sort all items by weight, <span style={{ color: "#534AB7", fontWeight: 500 }}>heaviest first</span><br />2. For each item, find the truck with <span style={{ color: "#534AB7", fontWeight: 500 }}>least remaining space</span> that fits<br />3. If no truck fits, <span style={{ color: "#534AB7", fontWeight: 500 }}>open a new truck</span><br />4. If item exceeds 42,500 lbs, <span style={{ color: "#534AB7", fontWeight: 500 }}>split by pallet</span> across two trucks</div>
        <div style={{ margin: "10px 0" }}>
          {[{ label: "Truck 1", pct: 92, lbs: "39,100", color: "#059669" }, { label: "Truck 2", pct: 85, lbs: "36,200", color: "#059669" }, { label: "Truck 3", pct: 21, lbs: "9,100", color: "#D97706" }].map(function(t) {
            return <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", minWidth: 50 }}>{t.label}</span>
              <div style={{ flex: 1, height: 14, background: "var(--color-background-primary)", borderRadius: 3, border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}><div style={{ height: "100%", width: t.pct + "%", background: t.color, borderRadius: 3 }} /></div>
              <span style={{ fontSize: 10, fontWeight: 500, color: t.color, minWidth: 64, textAlign: "right" }}>{t.lbs} lbs</span>
            </div>;
          })}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Trucks under 35,000 lbs (amber) are flagged for fill suggestions.</div>
      </div>; }
      },
      { t: "Fill suggestions", c: function() { return <div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>Cross-references two data sources to find good candidates for underfilled trucks:</div>
        <div style={wtS.formula}>Start with all Netstock items for the warehouse<br /><span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u2192"}</span> Remove items already on the order<br /><span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u2192"}</span> Remove items not in Acumatica Replen Class A/B/C<br /><span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u2192"}</span> Remove pawTree items<br /><span style={{ color: "#534AB7", fontWeight: 500 }}>{"\u2192"}</span> Sort by DOH + DOO ascending<br /><span style={{ color: "#D85A30", fontWeight: 500 }}>{"\u2248"} 130 candidates</span></div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4, fontWeight: 500 }}>Key columns:</div>
        <div style={{ background: "var(--color-background-primary)", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}>
          <table style={wtS.tbl}><thead><tr><th style={wtS.th}>Column</th><th style={wtS.th}>What it tells you</th></tr></thead>
          <tbody>
            <tr><td style={Object.assign({}, wtS.td, { fontWeight: 500 })}>DOH+DOO</td><td style={wtS.td}>Total days of stock coverage (lower = more urgent)</td></tr>
            <tr><td style={Object.assign({}, wtS.td, { fontWeight: 500 })}>Days/Pal</td><td style={wtS.td}>How many days one pallet covers (fixed rate)</td></tr>
            <tr><td style={Object.assign({}, wtS.td, { fontWeight: 500, color: "#7C3AED" })}>+Days</td><td style={wtS.td}>Total days being added at current pallet count (reactive)</td></tr>
            <tr><td style={Object.assign({}, wtS.td, { fontWeight: 500, color: "#059669" })}>Order Qty</td><td style={wtS.td}>Cases being ordered at current pallet count (reactive)</td></tr>
            <tr><td style={Object.assign({}, wtS.td, { fontWeight: 500 })}>Total Lbs</td><td style={wtS.td}>Weight impact on the truck (reactive)</td></tr>
          </tbody></table>
        </div>
      </div>; }
      },
      { t: "CSV export", c: function() { return <div>
        <div style={wtS.formula}><span style={{ color: "#534AB7", fontWeight: 500 }}>File name:</span> <span style={{ color: "#0F6E56", fontWeight: 500 }}>CA 4.11.26 Truck 1.csv</span><br /><span style={{ color: "#534AB7", fontWeight: 500 }}>Format:</span> Inventory ID, Warehouse, Order Qty<br /><span style={{ color: "#534AB7", fontWeight: 500 }}>Example:</span><br />8694, HILL-CP-CA, 576<br />10013, HILL-CP-CA, 520<br />6247, HILL-CP-CA, 800</div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6, fontWeight: 500 }}>Complete workflow timing:</div>
        <div style={{ background: "var(--color-background-primary)", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}>
          <table style={wtS.tbl}><thead><tr><th style={Object.assign({}, wtS.th, { width: 20 })}>#</th><th style={wtS.th}>Step</th><th style={Object.assign({}, wtS.th, { textAlign: "right" })}>Time</th></tr></thead>
          <tbody>
            <tr><td style={wtS.td}>1</td><td style={wtS.td}>Upload Hills Master (first time only)</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>30 sec</td></tr>
            <tr><td style={wtS.td}>2</td><td style={wtS.td}>Pick warehouse, Fetch Replenishment</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>5 sec</td></tr>
            <tr><td style={wtS.td}>3</td><td style={wtS.td}>Review order table, adjust if needed</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>1 min</td></tr>
            <tr><td style={wtS.td}>4</td><td style={wtS.td}>Optimize Trucks</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>1 sec</td></tr>
            <tr><td style={wtS.td}>5</td><td style={wtS.td}>Upload DOH, add fill items</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>3 min</td></tr>
            <tr><td style={wtS.td}>6</td><td style={wtS.td}>Re-optimize, export CSVs</td><td style={Object.assign({}, wtS.td, { textAlign: "right" })}>10 sec</td></tr>
          </tbody></table>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 8 }}>Total: under 5 minutes. The old Google Sheets workflow took 15-20 minutes.</div>
      </div>; }
      }
    ];

    return <div style={{ borderRadius: 10, border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 0, overflowX: "auto", borderBottom: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
        {wtTabs.map(function(tab, idx) {
          var isActive = wtStep === idx;
          return <button key={idx} onClick={function() { setWtStep(idx); }} style={{ padding: "8px 12px", fontSize: 11, fontWeight: isActive ? 500 : 400, border: "none", borderBottom: isActive ? "2px solid #D97706" : "2px solid transparent", cursor: "pointer", background: "transparent", color: isActive ? "#D97706" : "var(--color-text-secondary)", whiteSpace: "nowrap", transition: "all 0.15s" }}>{(idx + 1) + ". " + tab.t}</button>;
        })}
      </div>
      <div style={{ padding: 14 }}>{wtTabs[wtStep].c()}</div>
    </div>;
  }

  return <div>
    <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>Click any section below to see how it works. All tools require an Acumatica login unless noted otherwise.</p>

    <Section id="po" title="PO tools (Brooklyn, Ohio, Hayward, GoGoMeds)" color="#3B82F6">
      <p style={{ marginBottom: 12 }}>Each warehouse tab shows today's purchase orders from Acumatica, grouped by vendor. This is your daily ordering dashboard.</p>
      <Step n="1" color="#3B82F6">Click a warehouse in the sidebar (e.g. Brooklyn, Ohio). The tool fetches today's POs from Acumatica via OData.</Step>
      <Step n="2" color="#3B82F6">Review the order table. Items are grouped by vendor with shipping cost status shown. Short-dating items are flagged red, sell-off items orange. Flagged items sort to the top.</Step>
      <Step n="3" color="#3B82F6">Add shipping notes per vendor if needed. These are saved and shared with your team via KV storage.</Step>
      <Step n="4" color="#3B82F6">Click "Generate Email Drafts" to create one Gmail draft per vendor with the order details as an attached spreadsheet. Drafts appear in your Gmail ready to review and send.</Step>
      <Note>Data syncs across devices. If someone else fetches POs, your view updates within 8 seconds. Shipping rules (free shipping thresholds, fee calculations) are configurable under Settings {">"} Vendor Settings.</Note>
      <Note>For TP warehouses (Brooklyn, Ohio, Hayward), email is blocked when flagged items are present to prevent accidentally ordering short-dated product. GoGoMeds is exempt from this rule.</Note>
    </Section>

    <Section id="ndc" title="PO NDC validator" color="#06B6D4">
      <p style={{ marginBottom: 12 }}>Validates purchase orders from vendor confirmations (PDFs or McKesson portal data) against Acumatica's NDC cross-reference to catch mismatches before importing.</p>
      <Step n="1" color="#06B6D4">Select vendor type: "Other Vendors" for PDF confirmations, or "McKesson" for portal copy-paste.</Step>
      <Step n="2" color="#06B6D4">For PDFs: drag and drop one or more vendor confirmation PDFs. The tool parses them server-side to extract NDCs and quantities. For McKesson: paste the order data from the portal or upload the confirmation file.</Step>
      <Step n="3" color="#06B6D4">The tool cross-references each NDC against Acumatica's item cross-reference table. It shows matches, mismatches, and items not found in your system.</Step>
      <Step n="4" color="#06B6D4">Review results, edit prices or quantities if needed, then download the validated CSV ready for Acumatica import.</Step>
      <Note>The NDC lookup data is fetched from Acumatica each time. Upload a Stock Items export to also pull the correct Sales Unit (UoM) for each item.</Note>
    </Section>

    <Section id="cycle" title="Cycle counting" color="#14B8A6">
      <p style={{ marginBottom: 12 }}>Compares physical inventory counts (from warehouse SFTP BOH reports or CSV uploads) against Acumatica stock levels to identify discrepancies.</p>
      <Step n="1" color="#14B8A6">Upload or paste your physical count data: either an SFTP BOH report from the warehouse, or a CSV with NDCs and counted quantities.</Step>
      <Step n="2" color="#14B8A6">Upload a Stock Items export from Acumatica (cached locally so you only need to do this once until the data changes).</Step>
      <Step n="3" color="#14B8A6">Select the warehouse and click Process. The tool matches items by NDC and shows the variance between physical count and system quantity.</Step>
      <Step n="4" color="#14B8A6">Download the discrepancy report as a CSV for review or adjustment in Acumatica.</Step>
    </Section>

    <Section id="trackers" title="Short-dating and backorder trackers" color="#E879F9">
      <p style={{ marginBottom: 12 }}>These two tools work identically but pull different data from Acumatica.</p>
      <p style={{ marginBottom: 8 }}><span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>Short-Dating</span> shows items approaching expiration with their best-known dating. Use it to identify products that need to be sold, returned, or disposed of before they expire.</p>
      <p style={{ marginBottom: 12 }}><span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>Backorders</span> shows items that are backordered from vendors with recovery dates and open quantities. Use it to track when stock will be available again.</p>
      <Step n="1" color="#E879F9">Click "Sync Data" to pull the latest data from Acumatica. Results are cached locally.</Step>
      <Step n="2" color="#E879F9">Filter by vendor or search for specific items. Data is displayed in a sortable table.</Step>
      <Step n="3" color="#E879F9">Click "Generate Email Drafts" to create vendor-specific email drafts asking about better dating availability (short-dating) or recovery ETA updates (backorders).</Step>
      <Note>Both tools fetch from dedicated Acumatica Generic Inquiries that surface the relevant item status data.</Note>
    </Section>

    <Section id="hills" title="Hills and Pawtree tracker" color="#10B981">
      <p style={{ marginBottom: 12 }}>Tracks all open purchase orders for Hill's and Pawtree vendors. Shows PO number, date ordered, vendor, and warehouse with editable ETA and notes fields that sync across your team.</p>
      <Step n="1" color="#10B981">Data loads automatically from a dedicated Acumatica GI that shows open and pending-approval POs for Hill's (VID0024) and Pawtree (VID0040).</Step>
      <Step n="2" color="#10B981">Add ETA dates and notes for each PO. These are saved to KV storage and sync with other users every 10 seconds.</Step>
      <Step n="3" color="#10B981">Filter by vendor (Hills vs Pawtree) or warehouse (CA, NJ, Pawtree). The table color-codes POs by age.</Step>
      <Note>PO age coloring: green = recent, yellow = 5+ days, orange = 10+ days, red = 15+ days since ordered.</Note>
    </Section>

    <Section id="fuze" title="Fuze tracker" color="#F59E0B">
      <p style={{ marginBottom: 12 }}>Tracks shipments processed by Fuze Health (your 3PL) across Brooklyn, Seven Hills, and Hayward warehouses. Shows PO details, tracking numbers, and received/landed status.</p>
      <Step n="1" color="#F59E0B">Select a warehouse tab. Data loads from a connected Google Sheet that Fuze maintains.</Step>
      <Step n="2" color="#F59E0B">Filter by vendor, search for specific POs or tracking numbers, or filter by status (pending, received, landed).</Step>
      <Step n="3" color="#F59E0B">Stats cards at the top show total items, received count, landed count, and pending count for a quick overview.</Step>
      <Note>This tool does not require Acumatica login. Data comes directly from the shared Fuze tracking sheets.</Note>
    </Section>

    <Section id="truck" title="Truckloader (Hills)" color="#D97706">
      <p style={{ marginBottom: 12 }}>Automates the entire Hill's truck ordering workflow: pull replenishment needs from Acumatica, calculate pallet quantities, optimize items into 42,500 lb trucks, find fill items from Netstock, and export CSVs for import.</p>

      <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginTop: 16, marginBottom: 6, fontSize: 13 }}>Data sources</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ background: "#E1F5EE", color: "#085041", padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500 }}>Acumatica GI (live)</span>
        <span style={{ background: "#FAEEDA", color: "#633806", padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500 }}>Hills Master (upload once)</span>
        <span style={{ background: "#FAECE7", color: "#712B13", padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500 }}>Netstock DOH (fill only)</span>
      </div>

      <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginTop: 16, marginBottom: 6, fontSize: 13 }}>Workflow</div>
      <Step n="1" color="#D97706">Upload Hills Master spreadsheet (first time only, saved to cloud storage). This provides pallet weights and cases per pallet for every Hill's item.</Step>
      <Step n="2" color="#D97706">Select warehouse (HILL-CP-CA or HILL-CP-NJ) and click Fetch Replenishment. The tool queries a custom Acumatica GI that finds items below reorder point, then filters client-side using the formula: QtyAvail + OnPO {"<="} ReorderPoint to match Prepare Replenishment exactly.</Step>
      <Step n="3" color="#D97706">The order table auto-calculates: Case Need = MaxQty - QtyAvail - OnPO, rounded up to full pallets using Hills Master data. Review quantities, edit Case Need if needed.</Step>
      <Step n="4" color="#D97706">Click Optimize Trucks. The bin-packing algorithm sorts items heaviest-first, then fits each into the truck with the least remaining space. Target is 42,500 lbs per truck. Items over one truck's capacity are automatically split by pallet count.</Step>
      <Step n="5" color="#D97706">If a truck is under 35,000 lbs, use Fill Suggestions. Upload a Netstock DOH export, click Build Suggestions. The tool cross-references Acumatica's Whse Replenish for replenishment class (A/B/C only), excludes already-ordered items, and sorts by DOH+DOO ascending.</Step>
      <Step n="6" color="#D97706">The fill page shows a split layout: suggestions on the left with Days/Pal and +Days columns for easy mental math, and a sticky panel on the right showing truck status and items you've added. Adjust pallets, click + to add, then re-optimize.</Step>
      <Step n="7" color="#D97706">Export CSVs per truck (Inventory ID, Warehouse, Order Qty format) for Acumatica import.</Step>

      <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginTop: 16, marginBottom: 6, fontSize: 13 }}>The Acumatica GI</div>
      <Note>The "PURCH - Replenishment Needs" GI joins INItemSite (reorder settings), INSiteStatus (live stock), and InventoryItem (descriptions). Conditions: QtyAvail {"<="} MinQty AND MinQty {">"} 0 AND ItemStatus = Active AND warehouse is HILL-CP-CA or NJ. Exposed via OData. The GI returns all items below reorder point (~66); the website further filters to ~37 that genuinely need ordering by accounting for stock already on PO.</Note>

      <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginTop: 20, marginBottom: 10, fontSize: 13 }}>Deep dive walkthrough</div>
      <TruckloaderWalkthrough />
    </Section>

    <Section id="rules" title="Shipping rules" color="#6B7280">
      <p style={{ marginBottom: 12 }}>Configure vendor-specific shipping cost rules used by the PO tools. Rules are saved in your browser.</p>
      <Note>Rule format examples: "message:Free Shipping" for always-free vendors, "min:5000; message:Free Shipping; else:Not Free Shipping" for minimum order thresholds, "range:0-99.99=15%; range:100-1499.99=8%; min:1500; message:Free Shipping" for tiered percentage-based fees. Rules can be added, edited, or removed per vendor.</Note>
    </Section>
  </div>;
}
/* ═══════ TRUCKLOADER TOOL ═══════ */
function TruckloaderTool(props) {
  var toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred, gmail = props.gmail;
  var TOOL_COLOR = "#D97706";
  var TARGET = 42500;
  var MIN_WEIGHT = 35000;
  var TRUCK_COLORS = ["#d9ead3","#cfe2f3","#fff2cc","#f4cccc","#ead1dc","#d9d2e9","#fce5cd","#d0e0e3","#ccddff","#ccffcc","#ffe5cc","#e5ccff"];
  // Truckloader warehouse map. Add new Hill's CP warehouses here.
  // shortCode is used for CSV filename + email subject ("Vetcove <shortCode>").
  // cpTo is the Central Pet recipient list for the email tab.
  var WH_META = {
    "HILL-CP-CA": { label: "California", shortCode: "CA", cpTo: "ap.petd.santafesprings@central.com, jcanter@centralpet.com, jspengler@central.com, hd-purchaseorders@vetcove.com" },
    "HILL-CP-NJ": { label: "New Jersey", shortCode: "NJ", cpTo: "jcanter@centralpet.com, jspengler@central.com, hd-purchaseorders@vetcove.com, gcustode@central.com" },
    "HILL-CP-FL": { label: "Tampa",      shortCode: "Tampa",  cpTo: "jcanter@centralpet.com, jspengler@central.com, hd-purchaseorders@vetcove.com" },
    "HILL-CP-TX": { label: "Dallas",     shortCode: "Dallas", cpTo: "mcabrera@centralpet.com, jcanter@centralpet.com, jspengler@central.com, hd-purchaseorders@vetcove.com" },
  };
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);

  var _wh = useState("HILL-CP-CA"), warehouse = _wh[0], setWarehouse = _wh[1];
  var _hm = useState(null), hillsMaster = _hm[0], setHillsMaster = _hm[1];
  var _hmLoad = useState(true), hmLoading = _hmLoad[0], setHmLoading = _hmLoad[1];
  var _replen = useState([]), replenData = _replen[0], setReplenData = _replen[1];
  var _rLoad = useState(false), replenLoading = _rLoad[0], setReplenLoading = _rLoad[1];
  var _order = useState([]), orderItems = _order[0], setOrderItems = _order[1];
  var _confirmRemove = useState(null), confirmRemove = _confirmRemove[0], setConfirmRemove = _confirmRemove[1];
  var _trucks = useState(null), truckGroups = _trucks[0], setTruckGroups = _trucks[1];
  var _step = useState("order"), step = _step[0], setStep = _step[1];
  var _nsDoh = useState(null), netstockDoh = _nsDoh[0], setNetstockDoh = _nsDoh[1];
  var _fills = useState(null), fillSuggestions = _fills[0], setFillSuggestions = _fills[1];
  var _highlight = useState("all"), highlightTruck = _highlight[0], setHighlightTruck = _highlight[1];
  var _fillAdded = useState([]), fillAdded = _fillAdded[0], setFillAdded = _fillAdded[1];
  var _orderSort = useState(null), orderSort = _orderSort[0], setOrderSort = _orderSort[1];
  var _dohTarget = useState(45), dohTarget = _dohTarget[0], setDohTarget = _dohTarget[1];
  var _fillPals = useState({}), fillPals = _fillPals[0], setFillPals = _fillPals[1];
  var _hillsDraftSent = useState(false), hillsDraftSent = _hillsDraftSent[0], setHillsDraftSent = _hillsDraftSent[1];
  var _cpDraftSent = useState(false), cpDraftSent = _cpDraftSent[0], setCpDraftSent = _cpDraftSent[1];
  var _emailOverrides = useState({}), emailOverrides = _emailOverrides[0], setEmailOverrides = _emailOverrides[1];
  var _editingEmail = useState(null), editingEmail = _editingEmail[0], setEditingEmail = _editingEmail[1];
  var _emailEditValue = useState(""), emailEditValue = _emailEditValue[0], setEmailEditValue = _emailEditValue[1];
  var fileRef = useRef(null);
  var nsFileRef = useRef(null);

  // Load Hills Master from KV on mount
  useEffect(function() {
    var m = true;
    (async function() {
      try {
        var resp = await kvGet("hills-master");
        var json = await resp.json();
        if (m && json.data && json.data.items && json.data.items.length > 0) {
          setHillsMaster(json.data);
          sSet("hills-master", json.data);
          if (m) setHmLoading(false);
          return;
        }
      } catch (e) {}
      if (m) {
        var saved = sGet("hills-master");
        if (saved && saved.items) setHillsMaster(saved);
        setHmLoading(false);
      }
    })();
    return function() { m = false; };
  }, []);

  // Load Email recipient overrides from KV (shared with team)
  useEffect(function() {
    var m = true;
    kvGet("truckloader-email-overrides").then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (m && d && d.data && typeof d.data === "object") setEmailOverrides(d.data);
    }).catch(function() {});
    return function() { m = false; };
  }, []);

  // Load Netstock DOH from KV on mount (wipes at 4am EST daily)
  useEffect(function() {
    var m = true;
    kvGet("netstock-doh").then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m || !d || !d.data || !d.data.items) return;
      var savedAt = d.data._savedAt || 0;
      var now = new Date();
      var et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      var reset = new Date(et); reset.setHours(4, 0, 0, 0);
      if (et < reset) reset.setDate(reset.getDate() - 1);
      if (savedAt < reset.getTime()) { kvPost("netstock-doh", { _savedAt: Date.now() }); return; }
      setNetstockDoh({ items: d.data.items, fileName: d.data.fileName || "Loaded from cloud" });
    }).catch(function() {});
    return function() { m = false; };
  }, []);

  // Parse Hills Master xlsx
  function handleHillsUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var XLSX = require("xlsx");
        var wb = XLSX.read(ev.target.result, { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (rows.length === 0) { toast("No data found in file", "error"); return; }
        var items = rows.map(function(r) {
          var id = String(r["Inventory ID"] || r["InventoryID"] || r["inventory id"] || "").trim();
          var utp = parseFloat(r["Units to Pallet"] || r["UnitsToPallet"] || 0);
          var pgw = parseFloat(r["Pallet Gross Weight"] || r["PalletGrossWeight"] || 0);
          var desc = r["Description"] || r["Descr"] || "";
          return { id: id, unitsPerPallet: utp, palletWeight: pgw, description: desc };
        }).filter(function(x) { return x.id && x.palletWeight > 0; });
        var data = { items: items, uploadedAt: Date.now(), fileName: file.name };
        setHillsMaster(data);
        sSet("hills-master", data);
        kvPost("hills-master", data).catch(function() {});
        toast("Hills Master loaded: " + items.length + " items");
      } catch (err) { toast("Error parsing file: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  // Build Hills Master lookup
  var hmLookup = useMemo(function() {
    if (!hillsMaster || !hillsMaster.items) return {};
    var m = {};
    hillsMaster.items.forEach(function(it) { m[it.id] = it; });
    return m;
  }, [hillsMaster]);

  // Fetch replenishment needs from GI
  var fetchReplen = useCallback(async function() {
    if (!ok) { lp(); return; }
    if (!hillsMaster) { toast("Upload Hills Master first", "error"); return; }
    setReplenLoading(true);
    setTruckGroups(null);
    setStep("order");
    setFillSuggestions(null);
    setFillAdded([]);
    setFillPals({});
    try {
      var rows = await fetchAcumatica("replenishment-needs", null, cred.username, cred.password);
      setReplenData(rows);
      // Filter by warehouse client-side (GI params don't pass through OData)
      var whRows = rows.filter(function(r) { return String(r.Warehouse || "").trim() === warehouse; });
      // Filter: QtyAvail + OnPO + POPrepared < ReorderPoint (match Prepare Replenishment)
      var filtered = whRows.filter(function(r) {
        var avail = parseFloat(r.QtyAvailable) || 0;
        var onPO = parseFloat(r.OnPO) || 0;
        var poPrepared = parseFloat(r.POPrepared) || 0;
        var reorder = parseFloat(r.ReorderPoint) || 0;
        return (avail + onPO + poPrepared) < reorder && reorder > 0;
      });
      // Build order items with Hills Master lookup
      var items = filtered.map(function(r) {
        var id = String(r.InventoryID || "").trim();
        var hm = hmLookup[id] || {};
        var maxQty = parseFloat(r.MaxQty) || 0;
        var avail = parseFloat(r.QtyAvailable) || 0;
        var onPO = parseFloat(r.OnPO) || 0;
        var poPrepared = parseFloat(r.POPrepared) || 0;
        var caseNeed = Math.max(0, Math.round(maxQty - avail - onPO - poPrepared));
        var casesPerPallet = hm.unitsPerPallet || 0;
        var lbsPerPallet = hm.palletWeight || 0;
        var palletCount = casesPerPallet > 0 ? caseNeed / casesPerPallet : 0;
        var roundedPallets = Math.ceil(palletCount);
        var orderQty = roundedPallets * (casesPerPallet || 1);
        var totalLbs = roundedPallets * lbsPerPallet;
        return {
          inventoryID: id,
          description: r.Description || hm.description || "",
          caseNeed: caseNeed,
          casesPerPallet: casesPerPallet,
          roundedPallets: roundedPallets,
          orderQty: orderQty,
          lbsPerPallet: lbsPerPallet,
          totalLbs: totalLbs,
          qtyAvail: parseFloat(r.QtyAvailable) || 0,
          onPO: parseFloat(r.OnPO) || 0,
          reorderPt: parseFloat(r.ReorderPoint) || 0,
          maxQty: maxQty,
          inHillsMaster: !!hm.unitsPerPallet,
        };
      }).filter(function(x) { return x.caseNeed > 0; });
      setOrderItems(items);
      toast("Loaded " + items.length + " items to order for " + warehouse);
    } catch (err) { toast("Error: " + err.message, "error"); }
    setReplenLoading(false);
  }, [ok, lp, cred, warehouse, hillsMaster, hmLookup, toast]);

  // Recalculate a single order item when user edits caseNeed
  function updateCaseNeed(idx, val) {
    var items = orderItems.slice();
    var it = Object.assign({}, items[idx]);
    it.caseNeed = Math.max(0, parseInt(val) || 0);
    var cpp = it.casesPerPallet || 1;
    it.roundedPallets = Math.ceil(it.caseNeed / cpp);
    it.orderQty = it.roundedPallets * cpp;
    it.totalLbs = it.roundedPallets * it.lbsPerPallet;
    items[idx] = it;
    setOrderItems(items);
    setTruckGroups(null);
  }

  function removeItem(idx) {
    var item = orderItems[idx];
    if (item && !item.isFill) {
      setConfirmRemove({ id: item.inventoryID, action: function() { var items = orderItems.slice(); items.splice(idx, 1); setOrderItems(items); setTruckGroups(null); setConfirmRemove(null); } });
      return;
    }
    var items = orderItems.slice();
    items.splice(idx, 1);
    setOrderItems(items);
    setTruckGroups(null);
  }

  // DOH-priority truck optimizer: lowest DOH → Truck 1
  function optimizeTrucks() {
    if (orderItems.length === 0) { toast("No items to optimize", "error"); return; }
    var target = TARGET * 100;
    var minW = MIN_WEIGHT * 100;
    // Build DOH lookup from Netstock if uploaded
    var dohLookup = {};
    if (netstockDoh && netstockDoh.items) {
      netstockDoh.items.forEach(function(ns) { dohLookup[ns.productCode] = ns.doh; });
    }
    var available = [];
    var errors = [];
    orderItems.forEach(function(item, idx) {
      var weight = Math.round(item.totalLbs * 100);
      if (weight <= 0) return;
      var doh = dohLookup[item.inventoryID] != null ? dohLookup[item.inventoryID] : null;
      var urgency = doh != null ? doh : item.qtyAvail;
      if (weight > target) {
        if (item.lbsPerPallet > 0 && item.roundedPallets > 0) {
          var maxPals = Math.floor(target / Math.round(item.lbsPerPallet * 100));
          var remainder = item.roundedPallets - maxPals;
          if (maxPals === 0) { errors.push({ idx: idx, reason: "Single pallet > 42,500 lbs" }); return; }
          var c1 = maxPals * Math.round(item.lbsPerPallet * 100);
          var c2 = remainder * Math.round(item.lbsPerPallet * 100);
          if (c2 > target) { errors.push({ idx: idx, reason: "Too large, needs 2+ splits" }); return; }
          available.push({ weight: c1, idx: idx, isSplit: true, splitPals: maxPals, urgency: urgency });
          available.push({ weight: c2, idx: idx, isSplit: true, splitPals: remainder, urgency: urgency });
        } else { errors.push({ idx: idx, reason: "Missing pallet info for split" }); }
      } else {
        available.push({ weight: weight, idx: idx, isSplit: false, urgency: urgency });
      }
    });
    // Sort by urgency ascending (lowest DOH/qty first → Truck 1), tiebreak by inventoryID
    available.sort(function(a, b) { var d = a.urgency - b.urgency; if (d !== 0) return d; var idA = orderItems[a.idx].inventoryID || ""; var idB = orderItems[b.idx].inventoryID || ""; return idA.localeCompare(idB); });
    // Sequential first-fit: fill Truck 1 first, then 2, etc.
    var groups = [];
    available.forEach(function(item) {
      var placed = false;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].total + item.weight <= target) {
          groups[i].items.push(item); groups[i].total += item.weight;
          placed = true; break;
        }
      }
      if (!placed) { groups.push({ items: [item], total: item.weight }); }
    });
    // Build truck assignments
    var trucks = groups.map(function(g, ti) {
      var totalLbs = g.total / 100;
      var remaining = (target - g.total) / 100;
      var needsFill = g.total < minW;
      var assignments = g.items.map(function(it) {
        var oi = orderItems[it.idx];
        return { inventoryID: oi.inventoryID, description: oi.description, orderQty: it.isSplit ? it.splitPals * oi.casesPerPallet : oi.orderQty, pallets: it.isSplit ? it.splitPals : oi.roundedPallets, lbs: it.weight / 100, isSplit: it.isSplit, idx: it.idx };
      });
      return { label: "Truck " + (ti + 1), totalLbs: totalLbs, remaining: remaining, needsFill: needsFill, color: TRUCK_COLORS[ti % TRUCK_COLORS.length], assignments: assignments, errors: [] };
    });
    // Add errors to a virtual truck
    if (errors.length > 0) {
      var errAssign = errors.map(function(e) { return { inventoryID: orderItems[e.idx].inventoryID, description: orderItems[e.idx].description, error: e.reason, idx: e.idx }; });
      trucks.push({ label: "Errors", totalLbs: 0, remaining: 0, needsFill: false, color: "#ff9999", assignments: errAssign, errors: errors, isError: true });
    }
    setTruckGroups(trucks);
    setFillAdded([]);
    setStep("trucks");
    var underFill = trucks.filter(function(t) { return t.needsFill; }).length;
    var dohNote = Object.keys(dohLookup).length > 0 ? " (sorted by DOH)" : " (sorted by available qty)";
    if (underFill > 0) toast(trucks.length + " trucks created" + dohNote + ". " + underFill + " flagged to fill (<35k lbs)", "info");
    else toast(trucks.length + " trucks optimized" + dohNote + "!");
  }

  // ─── Acumatica PO creation state + handler ───
  var _acuLoading = useState(false), acuLoading = _acuLoading[0], setAcuLoading = _acuLoading[1];
  var _acuConfirm = useState(false), acuConfirm = _acuConfirm[0], setAcuConfirm = _acuConfirm[1];
  var _acuResult  = useState(null),  acuResult  = _acuResult[0],  setAcuResult  = _acuResult[1];

  async function createPOsInAcumatica() {
    setAcuConfirm(false);
    if (!truckGroups || truckGroups.length === 0) { toast("No trucks to create", "error"); return; }
    if (!cred || !cred.username || !cred.password) { toast("Acumatica credentials required", "error"); lp && lp(); return; }

    var validTrucks = truckGroups.filter(function(t) { return !t.isError; });
    if (validTrucks.length === 0) { toast("No valid trucks to create", "error"); return; }

    var trucksPayload = validTrucks.map(function(t) {
      return {
        label: t.label,
        lines: t.assignments.filter(function(a) { return !a.error; }).map(function(a) {
          return {
            inventoryID: String(a.inventoryID),
            orderQty: Number.isInteger(a.orderQty) ? a.orderQty : Math.round(a.orderQty)
          };
        })
      };
    }).filter(function(t) { return t.lines.length > 0; });

    if (trucksPayload.length === 0) { toast("No valid lines in any truck", "error"); return; }

    setAcuLoading(true);
    setAcuResult(null);
    try {
      var res = await fetch("/api/acumatica-create-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cred.username,
          password: cred.password,
          warehouse: warehouse,
          trucks: trucksPayload
        })
      });
      var data = await res.json();
      setAcuResult(data);
      if (data.ok) {
        toast("Created " + (data.succeeded || []).length + " PO(s) in Acumatica", "success");
      } else {
        toast("PO creation stopped: " + ((data.failure && data.failure.stage) || data.stage || "error"), "error");
      }
    } catch (err) {
      setAcuResult({ ok: false, stage: "network", error: String(err) });
      toast("Network error: " + err.message, "error");
    } finally {
      setAcuLoading(false);
    }
  }

  // CSV export for a single truck
  function exportTruckCSV(truck, whShort) {
    var now = new Date();
    var dateStr = (now.getMonth() + 1) + "." + ("0" + now.getDate()).slice(-2) + "." + String(now.getFullYear()).slice(-2);
    var shortCode = (WH_META[warehouse] && WH_META[warehouse].shortCode) || warehouse;
    var fileName = shortCode + " " + dateStr + " " + truck.label + ".csv";
    var lines = ["Inventory ID,Warehouse,Order Qty."];
    truck.assignments.forEach(function(a) {
      if (!a.error) {
        var qty = Number.isInteger(a.orderQty) ? a.orderQty : Math.round(a.orderQty);
        lines.push(a.inventoryID + "," + warehouse + "," + qty);
      }
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Downloaded " + fileName);
  }

  function exportAllCSVs() {
    if (!truckGroups) return;
    var idx = 0;
    function next() {
      if (idx >= truckGroups.length) return;
      var t = truckGroups[idx];
      if (!t.isError) exportTruckCSV(t);
      idx++;
      setTimeout(next, 400);
    }
    next();
  }

  // Parse Netstock DOH upload
  function handleNetstockUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var XLSX = require("xlsx");
        var wb = XLSX.read(ev.target.result, { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        var items = rows.map(function(r) {
          return {
            productCode: String(r["Product code"] || r["ProductCode"] || "").trim(),
            description: r["Product description"] || r["Description"] || "",
            location: String(r["Location code"] || r["LocationCode"] || "").trim(),
            onHand: parseFloat(r["On hand"] || 0),
            doh: parseFloat(r["Days on hand"] || 0),
            onOrder: parseFloat(r["On order"] || 0),
            doo: parseFloat(r["Days on order"] || 0),
            velocity: r["Velocity"] || "",
            netClass: r["Class"] || "",
            avgSales: parseFloat(r["Avg sales units (3m)"] || 0),
          };
        }).filter(function(x) { return x.productCode; });
        setNetstockDoh({ items: items, fileName: file.name });
        kvPost("netstock-doh", { items: items, fileName: file.name, _savedAt: Date.now() }).catch(function() {});
        toast("Netstock DOH loaded: " + items.length + " items");
      } catch (err) { toast("Error parsing Netstock file: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  // Build fill suggestions
  var _fillLoading = useState(false), fillLoading = _fillLoading[0], setFillLoading = _fillLoading[1];

  async function buildFillSuggestions() {
    if (!netstockDoh || !hillsMaster) { toast("Upload both Netstock DOH and Hills Master first", "error"); return; }
    if (!ok) { lp(); return; }
    setFillLoading(true);
    try {
      // Fetch Whse Replenish from Acumatica for real Replenishment Class
      var whseRows = await fetchAcumatica("whse-replenish", null, cred.username, cred.password);
      // Build lookup: "inventoryID|warehouse" → replenishment class
      var replenClassLookup = {};
      whseRows.forEach(function(r) {
        var id = String(r.InventoryID || "").trim();
        var wh = String(r.Warehouse || "").trim();
        var cls = String(r.ReplenishmentClass || "").trim().toUpperCase();
        if (id && wh) replenClassLookup[id + "|" + wh] = cls;
      });

      var orderedIds = {};
      orderItems.forEach(function(it) { orderedIds[it.inventoryID] = true; });

      var candidates = netstockDoh.items.filter(function(ns) {
        if (ns.location !== warehouse) return false;
        if (orderedIds[ns.productCode]) return false;
        // Only stocked items: Acumatica Replenishment Class A, B, or C
        var key = ns.productCode + "|" + warehouse;
        var cls = replenClassLookup[key] || "";
        if (cls !== "A" && cls !== "B" && cls !== "C") return false;
        // Exclude pawTree items
        var desc = (ns.description || "").toLowerCase();
        if (desc.indexOf("pawtree") !== -1 || desc.indexOf("paw tree") !== -1) return false;
        return true;
      }).map(function(ns) {
        var hm = hmLookup[ns.productCode] || {};
        var key = ns.productCode + "|" + warehouse;
        var combined = ns.doh + ns.doo;
        return {
          productCode: ns.productCode,
          description: ns.description || hm.description || "",
          replenClass: replenClassLookup[key] || "",
          doh: ns.doh,
          doo: ns.doo,
          combined: combined,
          onHand: ns.onHand,
          onOrder: ns.onOrder,
          velocity: ns.velocity,
          netClass: ns.netClass,
          avgSales: ns.avgSales,
          palletWeight: hm.palletWeight || 0,
          unitsPerPallet: hm.unitsPerPallet || 0,
        };
      });
      candidates.sort(function(a, b) { return a.combined - b.combined; });
      // Initialize pallet counts with suggested values
      var initPals = {};
      candidates.forEach(function(c) {
        var daily = c.avgSales > 0 ? c.avgSales / 30 : 0;
        var needed = Math.max(0, (dohTarget * daily) - c.onHand - c.onOrder);
        var sug = (c.unitsPerPallet > 0 && daily > 0) ? Math.max(1, Math.ceil(needed / c.unitsPerPallet)) : 1;
        initPals[c.productCode] = sug;
      });
      setFillPals(initPals);
      setFillSuggestions(candidates);
      toast("Found " + candidates.length + " stocked items (A/B/C) for " + warehouse);
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
    setFillLoading(false);
  }

  function addFillToOrder(f, pallets) {
    var pals = Math.max(1, parseInt(pallets) || 1);
    var hm = hmLookup[f.productCode] || {};
    var cpp = hm.unitsPerPallet || 0;
    var lpp = hm.palletWeight || 0;
    var orderQty = pals * (cpp || 1);
    var totalLbs = pals * lpp;
    var newItem = {
      inventoryID: f.productCode,
      description: f.description,
      caseNeed: orderQty,
      casesPerPallet: cpp,
      roundedPallets: pals,
      orderQty: orderQty,
      lbsPerPallet: lpp,
      totalLbs: totalLbs,
      qtyAvail: 0, onPO: 0, reorderPt: 0, maxQty: 0,
      inHillsMaster: !!hm.unitsPerPallet,
      isFill: true,
    };
    setOrderItems(orderItems.concat([newItem]));
    setFillAdded(fillAdded.concat([{ productCode: f.productCode, description: f.description, pallets: pals, orderQty: orderQty, totalLbs: totalLbs, _orig: f }]));
    if (fillSuggestions) {
      setFillSuggestions(fillSuggestions.filter(function(s) { return s.productCode !== f.productCode; }));
    }
    toast("Added " + f.productCode + " (" + pals + " pal) \u2192 " + totalLbs.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " lbs");
  }

  function removeFillItem(productCode) {
    setOrderItems(orderItems.filter(function(it) { return it.inventoryID !== productCode; }));
    var removed = fillAdded.find(function(a) { return a.productCode === productCode; });
    setFillAdded(fillAdded.filter(function(a) { return a.productCode !== productCode; }));
    // Add it back to suggestions list
    if (removed && removed._orig && fillSuggestions) {
      var updated = fillSuggestions.concat([removed._orig]);
      updated.sort(function(a, b) { return a.combined - b.combined; });
      setFillSuggestions(updated);
    }
    toast("Removed " + productCode + " from order");
  }

  function updateFillPallets(productCode, newPals) {
    var pals = Math.max(1, parseInt(newPals) || 1);
    var hm = hmLookup[productCode] || {};
    var cpp = hm.unitsPerPallet || 0;
    var lpp = hm.palletWeight || 0;
    var orderQty = pals * (cpp || 1);
    var totalLbs = pals * lpp;
    // Update order items
    setOrderItems(orderItems.map(function(it) {
      if (it.inventoryID !== productCode) return it;
      return Object.assign({}, it, { roundedPallets: pals, orderQty: orderQty, caseNeed: orderQty, totalLbs: totalLbs });
    }));
    // Update fill added tracker
    setFillAdded(fillAdded.map(function(a) {
      if (a.productCode !== productCode) return a;
      return Object.assign({}, a, { pallets: pals, orderQty: orderQty, totalLbs: totalLbs });
    }));
  }

  // Summary stats
  var totalWeight = useMemo(function() { return orderItems.reduce(function(s, it) { return s + it.totalLbs; }, 0); }, [orderItems]);
  var totalPallets = useMemo(function() { return orderItems.reduce(function(s, it) { return s + it.roundedPallets; }, 0); }, [orderItems]);
  var missingHM = useMemo(function() { return orderItems.filter(function(it) { return !it.inHillsMaster; }).length; }, [orderItems]);

  var hasFillFlag = truckGroups && truckGroups.some(function(t) { return t.needsFill; });

  return <div>
    {/* HEADER CARD - Warehouse selector + Hills Master */}
    <div style={Object.assign({}, S.card, { display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" })}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Warehouse</div>
        <select value={warehouse} onChange={function(e) { setWarehouse(e.target.value); setOrderItems([]); setTruckGroups(null); setFillSuggestions(null); setFillAdded([]); setFillPals({}); setHillsDraftSent(false); setCpDraftSent(false); setEditingEmail(null); setStep("order"); }} style={Object.assign({}, S.sel, { width: "100%", maxWidth: 280 })}>
          {Object.keys(WH_META).map(function(code) { return <option key={code} value={code}>{code} ({WH_META[code].label})</option>; })}
        </select>
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Hills Master</div>
        {hmLoading ? <Spinner color={TOOL_COLOR} size={16} /> : hillsMaster ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={S.badge("success")}><IconCheck /> {hillsMaster.items.length} items loaded</span>
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>{hillsMaster.fileName || ""}</span>
          <button onClick={function() { fileRef.current && fileRef.current.click(); }} style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "#6B7280" }}>Replace</button>
        </div> : <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={function() { fileRef.current && fileRef.current.click(); }} style={S.btn("ghost")}><IconUpload /> Upload Hills Master XLSX</button>
          <span style={{ fontSize: 11, color: "#DC2626" }}>Required</span>
        </div>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleHillsUpload} style={{ display: "none" }} />
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Netstock DOH</div>
        {netstockDoh ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={S.badge("success")}><IconCheck /> {netstockDoh.items.length} items</span>
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>{netstockDoh.fileName || ""}</span>
          <button onClick={function() { nsFileRef.current && nsFileRef.current.click(); }} style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "#6B7280" }}>Replace</button>
        </div> : <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={function() { nsFileRef.current && nsFileRef.current.click(); }} style={S.btn("ghost")}><IconUpload /> Upload DOH XLSX</button>
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>Optional</span>
        </div>}
        <input ref={nsFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleNetstockUpload} style={{ display: "none" }} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{"\u00A0"}</div>
        <button onClick={fetchReplen} disabled={replenLoading || !hillsMaster} style={Object.assign({}, S.btn(), { opacity: replenLoading || !hillsMaster ? 0.6 : 1 })}>
          {replenLoading ? <><Spinner color="#fff" size={14} /> Fetching...</> : <><IconRefresh /> Fetch Replenishment</>}
        </button>
      </div>
    </div>

    {/* STATS ROW */}
    {orderItems.length > 0 && <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
      <div style={Object.assign({}, S.statCard, { background: TOOL_COLOR + "12", border: "1px solid " + TOOL_COLOR + "30" })}>
        <div style={{ fontSize: 22, fontWeight: 700, color: TOOL_COLOR }}>{orderItems.length}</div>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Items</div>
      </div>
      <div style={Object.assign({}, S.statCard, { background: "#3B82F612", border: "1px solid #3B82F630" })}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#3B82F6" }}>{totalPallets}</div>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Total Pallets</div>
      </div>
      <div style={Object.assign({}, S.statCard, { background: "#05966912", border: "1px solid #05966930" })}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#059669" }}>{totalWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs</div>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Total Weight</div>
      </div>
      <div style={Object.assign({}, S.statCard, { background: "#7C3AED12", border: "1px solid #7C3AED30" })}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#7C3AED" }}>{Math.ceil(totalWeight / TARGET)}</div>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Est. Trucks</div>
      </div>
      {missingHM > 0 && <div style={Object.assign({}, S.statCard, { background: "#DC262612", border: "1px solid #DC262630" })}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#DC2626" }}>{missingHM}</div>
        <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>Missing from Hills Master</div>
      </div>}
    </div>}

    {/* TAB PILLS */}
    {orderItems.length > 0 && <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      <button onClick={function() { setStep("order"); }} style={S.pill(step === "order", TOOL_COLOR)}>Order Table</button>
      <button onClick={function() { if (truckGroups) setStep("trucks"); else toast("Run Optimize Trucks first", "info"); }} style={S.pill(step === "trucks", "#059669")}>Truck Assignments{truckGroups ? " (" + truckGroups.filter(function(t) { return !t.isError; }).length + ")" : ""}</button>
      <button onClick={function() { setStep("fill"); }} style={S.pill(step === "fill", "#7C3AED")}>Fill Suggestions</button>
      <button onClick={function() { setStep("email"); }} style={S.pill(step === "email", "#3B82F6")}>Email</button>
    </div>}

    {/* ORDER TABLE */}
    {step === "order" && orderItems.length > 0 && <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 600, color: "#374151" }}>Order Table — {warehouse}</span>
        <button onClick={optimizeTrucks} style={S.btn()}><IconBox /> Optimize Trucks</button>
      </div>
      <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid #E5E7EB" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 900 }}>
          <thead><tr>
            {["Inventory ID", "Description", "Order Qty", "Case Need", "Pallets", "Total Lbs", "Lbs/Pallet", "Cases/Pallet", ""].map(function(h) {
              var sortable = h === "Order Qty" || h === "Pallets" || h === "Total Lbs";
              var isSorted = orderSort && orderSort.col === h;
              var align = (h === "Inventory ID" || h === "Description" || h === "") ? "left" : "center";
              return <th key={h} onClick={sortable ? function() { setOrderSort(!isSorted ? { col: h, dir: "desc" } : orderSort.dir === "desc" ? { col: h, dir: "asc" } : null); } : undefined} style={Object.assign({}, S.th, { textAlign: align, cursor: sortable ? "pointer" : "default", userSelect: "none" }, h === "Order Qty" ? { background: "#F0FDF4", color: "#059669" } : {})}>{h}{isSorted ? (orderSort.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>;
            })}
          </tr></thead>
          <tbody>{(function() {
            var sorted = orderItems.slice();
            if (orderSort) {
              var key = orderSort.col === "Order Qty" ? "orderQty" : orderSort.col === "Pallets" ? "roundedPallets" : orderSort.col === "Total Lbs" ? "totalLbs" : null;
              if (key) sorted.sort(function(a, b) { return orderSort.dir === "desc" ? (b[key] || 0) - (a[key] || 0) : (a[key] || 0) - (b[key] || 0); });
            }
            return sorted;
          })().map(function(it, i) {
            var origIdx = orderItems.indexOf(it);
            var rowBg = !it.inHillsMaster ? "#FEF2F2" : i % 2 === 0 ? "#fff" : "#FAFAFA";
            return <tr key={it.inventoryID + "-" + i}>
              <td style={Object.assign({}, S.td, { background: rowBg, fontFamily: "monospace", fontSize: 12, fontWeight: 600 })}>{it.inventoryID}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })} title={it.description}>{it.description}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#059669" })}>{it.orderQty}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "center", width: 90 })}>
                <input type="number" min="0" value={it.caseNeed} onChange={function(e) { updateCaseNeed(origIdx, e.target.value); }} style={Object.assign({}, S.inp, { width: 70, textAlign: "right", padding: "4px 8px", color: "#9CA3AF" })} />
              </td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "center", fontWeight: 600 })}>{it.roundedPallets}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "center", fontWeight: 600, color: it.totalLbs > TARGET ? "#DC2626" : "#374151" })}>{it.totalLbs ? it.totalLbs.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "\u2014"}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "center", color: "#9CA3AF" })}>{it.lbsPerPallet ? it.lbsPerPallet.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "\u2014"}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "center", color: "#9CA3AF" })}>{it.casesPerPallet || "\u2014"}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, width: 40 })}>
                <button onClick={function() { removeItem(origIdx); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#DC2626", fontSize: 14 }}>{"\u2715"}</button>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>}

    {/* TRUCK ASSIGNMENTS */}
    {step === "trucks" && truckGroups && <div>
      <div style={Object.assign({}, S.card, { display: "flex", justifyContent: "space-between", alignItems: "center" })}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 600, color: "#374151" }}>Truck Assignments</span>
          <select value={highlightTruck} onChange={function(e) { setHighlightTruck(e.target.value); }} style={Object.assign({}, S.sel, { padding: "6px 12px", fontSize: 12 })}>
            <option value="all">Show All</option>
            {truckGroups.filter(function(t) { return !t.isError; }).map(function(t) { return <option key={t.label} value={t.label}>{t.label}</option>; })}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={function() { setStep("order"); setTruckGroups(null); }} style={S.btn("ghost")}><IconRefresh /> Re-edit Order</button>
          <button onClick={exportAllCSVs} style={S.btn()}><IconDL /> Export All CSVs</button>
          <button onClick={function() { setAcuConfirm(true); }} disabled={acuLoading} style={Object.assign({}, S.btn(), { background: acuLoading ? "#9CA3AF" : "#1E40AF", borderColor: acuLoading ? "#9CA3AF" : "#1E40AF" })}>
            {acuLoading ? <><Spinner /> Creating POs...</> : <>{"\u2192"} Create POs in Acumatica</>}
          </button>
        </div>
      </div>

      {/* ─── Acumatica confirmation modal ─── */}
      {acuConfirm && <div onClick={function() { setAcuConfirm(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
        <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 480, width: "90%", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#1F2937", marginBottom: 12 }}>Create POs in Acumatica?</div>
          <div style={{ fontSize: 14, color: "#4B5563", marginBottom: 8 }}>
            This will create <b>{truckGroups ? truckGroups.filter(function(t) { return !t.isError; }).length : 0} purchase order(s)</b> in Acumatica for vendor <b>Hill's (VID0024)</b> at warehouse <b>{warehouse}</b>.
          </div>
          <div style={{ fontSize: 13, color: "#6B7280", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 12px", marginBottom: 16 }}>
            All POs will be created with status <b>On Hold</b>. They will not release, print, or email Hill's until you manually click <b>Remove Hold</b> in Acumatica.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={function() { setAcuConfirm(false); }} style={S.btn("ghost")}>Cancel</button>
            <button onClick={createPOsInAcumatica} style={Object.assign({}, S.btn(), { background: "#1E40AF", borderColor: "#1E40AF" })}>Yes, Create POs</button>
          </div>
        </div>
      </div>}

      {/* ─── Acumatica results modal ─── */}
      {acuResult && <div onClick={function() { setAcuResult(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
        <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 600, width: "90%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: acuResult.ok ? "#059669" : "#DC2626", marginBottom: 12 }}>
            {acuResult.ok ? "All POs created" : "Stopped on failure"}
          </div>
          {acuResult.succeeded && acuResult.succeeded.length > 0 && <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#374151", fontWeight: 600, marginBottom: 8 }}>Created in Acumatica ({acuResult.succeeded.length}):</div>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
              <thead><tr>
                <th style={Object.assign({}, S.th, { textAlign: "left" })}>Truck</th>
                <th style={Object.assign({}, S.th, { textAlign: "left" })}>PO Number</th>
                <th style={Object.assign({}, S.th, { textAlign: "right" })}>Lines</th>
                <th style={Object.assign({}, S.th, { textAlign: "right" })}>Total</th>
              </tr></thead>
              <tbody>{acuResult.succeeded.map(function(s) {
                return <tr key={s.orderNbr}>
                  <td style={S.td}>{s.truckLabel}</td>
                  <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontWeight: 600 })}>{s.orderNbr}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right" })}>{s.lineCount}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right" })}>${(s.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>;
              })}</tbody>
            </table>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 8 }}>All POs are <b>On Hold</b>. Review in Acumatica before removing hold.</div>
          </div>}
          {acuResult.failure && <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#991B1B", marginBottom: 4 }}>
              Failed on: {acuResult.failure.truckLabel} ({acuResult.failure.stage})
            </div>
            {acuResult.failure.partialPO && <div style={{ fontSize: 12, color: "#991B1B", marginBottom: 4 }}>
              Partial PO created: <b>{acuResult.failure.partialPO.orderNbr}</b> — {acuResult.failure.partialPO.note}
            </div>}
            {acuResult.failure.errorDetails && acuResult.failure.errorDetails.length > 0 && <div style={{ fontSize: 12, color: "#991B1B", marginTop: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>What Acumatica reported:</div>
              {acuResult.failure.errorDetails.map(function(e, ei) {
                var label;
                if (e.scope === "line") {
                  label = "Line " + (e.lineIndex + 1) + (e.inventoryID ? " (item " + e.inventoryID + ")" : "") + " — " + e.field;
                } else if (e.scope === "header") {
                  label = "Header field " + e.field;
                } else {
                  label = "Acumatica";
                }
                return <div key={ei} style={{ background: "#FFF", borderLeft: "3px solid " + (e.scope === "header" ? "#B91C1C" : e.scope === "line" ? "#D97706" : "#6B7280"), padding: "6px 10px", marginBottom: 4, borderRadius: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 12, color: "#1F2937" }}>{e.message}</div>
                  {e.value !== undefined && e.value !== null && e.value !== "" && <div style={{ fontSize: 10, fontFamily: "monospace", color: "#6B7280", marginTop: 2 }}>value sent: {String(e.value)}</div>}
                </div>;
              })}
            </div>}
            {acuResult.failure.rawBody && <details style={{ fontSize: 11, marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "#6B7280" }}>Show technical details</summary>
              <pre style={{ background: "#FFF", padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200, marginTop: 4 }}>{acuResult.failure.rawBody}</pre>
            </details>}
          </div>}
          {acuResult.error && <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13, color: "#991B1B" }}>
            {acuResult.error}
          </div>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={function() { setAcuResult(null); }} style={S.btn()}>Done</button>
          </div>
        </div>
      </div>}

      {/* TRUCK SUMMARY TABLE */}
      <div style={Object.assign({}, S.card, { marginTop: 0 })}>
        <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid #E5E7EB" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead><tr>
              <th style={Object.assign({}, S.th, { background: "#374151", color: "#fff" })}>Truck #</th>
              <th style={Object.assign({}, S.th, { background: "#374151", color: "#fff" })}>Items</th>
              <th style={Object.assign({}, S.th, { background: "#374151", color: "#fff" })}>Total Weight</th>
              <th style={Object.assign({}, S.th, { background: "#374151", color: "#fff" })}>Remaining Space</th>
              <th style={Object.assign({}, S.th, { background: "#374151", color: "#fff", width: 90 })}>Export</th>
            </tr></thead>
            <tbody>{truckGroups.filter(function(t) { return !t.isError; }).map(function(t, ti) {
              return <tr key={t.label}>
                <td style={Object.assign({}, S.td, { fontWeight: 600 })}><Dot color={t.color} />{" "}{t.label}</td>
                <td style={S.td}>{t.assignments.length}</td>
                <td style={Object.assign({}, S.td, { fontWeight: 600 })}>{t.totalLbs.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs</td>
                <td style={S.td}>{t.needsFill ? <span style={Object.assign({}, S.badge("warning"))}>{"\uD83D\uDEA9"} FILL MORE ({t.remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs remaining)</span> : <span style={{ color: "#059669" }}>{t.remaining.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs</span>}</td>
                <td style={S.td}><button onClick={function() { exportTruckCSV(t); }} style={Object.assign({}, S.btn("ghost"), { padding: "4px 10px", fontSize: 11 })}><IconDL /> CSV</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>

      {/* DETAILED ITEM LIST BY TRUCK */}
      {truckGroups.filter(function(t) { return !t.isError && (highlightTruck === "all" || highlightTruck === t.label); }).map(function(t) {
        return <div key={t.label} style={Object.assign({}, S.card, { borderLeft: "4px solid " + t.color })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontWeight: 600, color: "#374151" }}>{t.label} — {t.totalLbs.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs</span>
            {t.needsFill && <span style={S.badge("warning")}>Needs Fill</span>}
          </div>
          <div style={{ overflow: "auto", borderRadius: 8, border: "1px solid #E5E7EB" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead><tr>
                <th style={S.th}>Inventory ID</th>
                <th style={S.th}>Description</th>
                <th style={Object.assign({}, S.th, { textAlign: "right" })}>Order Qty</th>
                <th style={Object.assign({}, S.th, { textAlign: "right" })}>Pallets</th>
                <th style={Object.assign({}, S.th, { textAlign: "right" })}>Weight</th>
                <th style={Object.assign({}, S.th, { width: 40 })}></th>
              </tr></thead>
              <tbody>{t.assignments.map(function(a, ai) {
                return <tr key={ai} style={{ background: t.color + "30" }}>
                  <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 12, fontWeight: 600 })}>{a.inventoryID}</td>
                  <td style={Object.assign({}, S.td, { maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })} title={a.description}>{a.description}{a.isSplit ? <span style={Object.assign({}, S.badge("purple"), { marginLeft: 6, fontSize: 10 })}>SPLIT</span> : ""}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right" })}>{a.orderQty}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right" })}>{a.pallets}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right", fontWeight: 600 })}>{a.lbs ? a.lbs.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " lbs" : "—"}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "center", padding: "8px 4px" })}><button onClick={function() { var id = a.inventoryID; var srcItem = orderItems.find(function(it) { return it.inventoryID === id; }); if (srcItem && !srcItem.isFill) { setConfirmRemove({ id: id, action: function() { setOrderItems(orderItems.filter(function(it) { return it.inventoryID !== id; })); var updated = truckGroups.map(function(tk) { if (tk.isError) return tk; var newAssign = tk.assignments.filter(function(x) { return x.inventoryID !== id; }); var newLbs = newAssign.reduce(function(s, x) { return s + (x.lbs || 0); }, 0); return Object.assign({}, tk, { assignments: newAssign, totalLbs: newLbs, remaining: TARGET - newLbs, needsFill: newLbs < MIN_WEIGHT }); }).filter(function(tk) { return tk.isError || tk.assignments.length > 0; }); setTruckGroups(updated); toast("Removed " + id); setConfirmRemove(null); } }); return; } setOrderItems(orderItems.filter(function(it) { return it.inventoryID !== id; })); var updated = truckGroups.map(function(tk) { if (tk.isError) return tk; var newAssign = tk.assignments.filter(function(x) { return x.inventoryID !== id; }); var newLbs = newAssign.reduce(function(s, x) { return s + (x.lbs || 0); }, 0); return Object.assign({}, tk, { assignments: newAssign, totalLbs: newLbs, remaining: TARGET - newLbs, needsFill: newLbs < MIN_WEIGHT }); }).filter(function(tk) { return tk.isError || tk.assignments.length > 0; }); setTruckGroups(updated); toast("Removed " + id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#D1D5DB", fontSize: 14, padding: 2, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }} title="Remove from order">{"\u2715"}</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>;
      })}
    </div>}

    {/* FILL SUGGESTIONS - SPLIT LAYOUT */}
    {step === "fill" && <div>
      <div style={Object.assign({}, S.card, { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" })}>
        <span style={{ fontWeight: 600, color: "#374151" }}>Fill Suggestions — {warehouse}</span>
        {netstockDoh ? <span style={S.badge("success")}><IconCheck /> {netstockDoh.items.length} items ({netstockDoh.fileName})</span> : <span style={{ fontSize: 12, color: "#DC2626" }}>Upload Netstock DOH above to build suggestions</span>}
        {netstockDoh && <button onClick={buildFillSuggestions} disabled={fillLoading} style={Object.assign({}, S.btn(), { opacity: fillLoading ? 0.6 : 1 })}>{fillLoading ? <><Spinner color="#fff" size={14} /> Loading...</> : <><IconFilter /> Build Suggestions</>}</button>}
      </div>
      {fillSuggestions && fillSuggestions.length > 0 && <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* LEFT - Suggestions table */}
        <div style={Object.assign({}, S.card, { marginTop: 0, flex: 1, minWidth: 0 })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>{fillSuggestions.length} items sorted by DOH+DOO</div>
          </div>
          <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid #E5E7EB", maxHeight: 600 }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead><tr>
                {["Inv ID", "Description", "R", "DOH+DOO", "On Hand", "Days/Pal", "+Days", "Pallets", "Order Qty", "Total Lbs", ""].map(function(h) {
                  var align = (h === "Inv ID" || h === "Description") ? "left" : "center";
                  if (h === "On Hand" || h === "Days/Pal" || h === "Order Qty" || h === "Total Lbs") align = "right";
                  return <th key={h} style={Object.assign({}, S.th, { padding: "8px 6px", fontSize: 10, textAlign: align }, h === "+Days" ? { color: "#7C3AED" } : {}, (h === "Pallets" || h === "Order Qty" || h === "Total Lbs" || h === "") ? { background: "#F0FDF4" } : {})}>{h}</th>;
                })}
              </tr></thead>
              <tbody>{fillSuggestions.slice(0, 150).map(function(f, fi) {
                var urgBg = f.combined === 0 ? "#FEF2F2" : f.combined <= 14 ? "#FFF7ED" : f.combined <= 30 ? "#FFFBEB" : "#FFFFFF";
                var urgCol = f.combined === 0 ? "#DC2626" : f.combined <= 14 ? "#EA580C" : f.combined <= 30 ? "#CA8A04" : "#16A34A";
                var dailySales = f.avgSales > 0 ? f.avgSales / 30 : 0;
                var unitsForTarget = Math.max(0, (dohTarget * dailySales) - f.onHand - f.onOrder);
                var sugPals = (f.unitsPerPallet > 0 && dailySales > 0) ? Math.max(1, Math.ceil(unitsForTarget / f.unitsPerPallet)) : "";
                var curPals = fillPals[f.productCode] || sugPals || 1;
                var rowLbs = curPals * (f.palletWeight || 0);
                return <tr key={fi} style={{ background: urgBg }}>
                  <td onClick={function() { navigator.clipboard.writeText(f.productCode); toast("Copied: " + f.productCode); }} style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, fontWeight: 600, padding: "6px 6px", cursor: "pointer", whiteSpace: "nowrap" })} title="Click to copy">{f.productCode}</td>
                  <td style={Object.assign({}, S.td, { maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "6px 6px", fontSize: 11 })} title={f.description}>{f.description}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "center", fontWeight: 700, padding: "6px 6px", fontSize: 11 })}>{f.replenClass}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "center", fontWeight: 700, color: urgCol, padding: "6px 6px", fontSize: 11 })}>{f.combined}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right", padding: "6px 6px", fontSize: 11 })}>{f.onHand}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right", padding: "6px 6px", fontSize: 11, color: "#9CA3AF" })}>{(dailySales > 0 && f.unitsPerPallet > 0) ? Math.round(f.unitsPerPallet / dailySales) : "\u2014"}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "center", padding: "6px 6px", fontSize: 11, fontWeight: 600, color: "#7C3AED" })}>{(dailySales > 0 && f.unitsPerPallet > 0) ? "+" + Math.round((curPals * f.unitsPerPallet) / dailySales) : "\u2014"}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "center", width: 44, padding: "4px 2px" })}><input type="number" min="1" value={curPals} onChange={function(e) { var u = Object.assign({}, fillPals); u[f.productCode] = Math.max(1, parseInt(e.target.value) || 1); setFillPals(u); }} style={Object.assign({}, S.inp, { width: 38, textAlign: "center", padding: "2px 2px", fontSize: 11 })} /></td>
                  <td style={Object.assign({}, S.td, { textAlign: "right", padding: "6px 6px", fontSize: 12, fontWeight: 700, color: "#059669" })}>{f.unitsPerPallet > 0 ? (curPals * f.unitsPerPallet) : "\u2014"}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right", padding: "6px 6px", fontSize: 11, fontWeight: 600 })}>{rowLbs > 0 ? rowLbs.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "\u2014"}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "center", width: 36, padding: "4px 2px" })}><button onClick={function() { addFillToOrder(f, fillPals[f.productCode] || sugPals || 1); }} style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 6, padding: "3px 7px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>

        {/* RIGHT - Sticky order panel */}
        <div style={{ width: 240, flexShrink: 0, position: "sticky", top: 16 }}>
          {/* Truck status */}
          {truckGroups && function() {
            var trucks = truckGroups.filter(function(t) { return !t.isError; });
            var lastTruck = trucks[trucks.length - 1];
            var fillTruck = trucks.find(function(t) { return t.needsFill; });
            var currentTruck = fillTruck || lastTruck;
            if (!currentTruck) return null;
            var addedLbs = fillAdded.reduce(function(s, a) { return s + a.totalLbs; }, 0);
            var liveLbs = currentTruck.totalLbs + addedLbs;
            var pct = Math.min(100, (liveLbs / TARGET) * 100);
            var remaining = TARGET - liveLbs;
            var barColor = remaining > 7500 ? "#F59E0B" : remaining > 0 ? "#059669" : "#DC2626";
            return <div style={Object.assign({}, S.card, { marginTop: 0, marginBottom: 12 })}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>{currentTruck.label}</div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>{trucks.length} truck{trucks.length > 1 ? "s" : ""} total</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#374151", marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{liveLbs.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs</span>
                <span style={{ color: "#9CA3AF" }}>/ {TARGET.toLocaleString()} lbs</span>
              </div>
              <div style={{ height: 10, background: "#F3F4F6", borderRadius: 5, overflow: "hidden", marginBottom: 6 }}><div style={{ height: "100%", width: pct + "%", background: barColor, borderRadius: 5, transition: "width 0.3s" }} /></div>
              {remaining > 0 && <div style={{ fontSize: 11, color: remaining > 7500 ? "#D97706" : "#059669", fontWeight: 500 }}>{remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs remaining</div>}
              {remaining <= 0 && <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 500 }}>{Math.abs(remaining).toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs over capacity</div>}
              <button onClick={optimizeTrucks} style={Object.assign({}, S.btn(), { width: "100%", justifyContent: "center", marginTop: 8, fontSize: 12, padding: "8px 12px" })}><IconBox /> Re-optimize</button>
            </div>;
          }()}

          {!truckGroups && <div style={Object.assign({}, S.card, { marginTop: 0, marginBottom: 12, textAlign: "center", padding: 16 })}>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 }}>{orderItems.length} items, {totalWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs total</div>
            <button onClick={optimizeTrucks} style={Object.assign({}, S.btn(), { width: "100%", justifyContent: "center", fontSize: 12, padding: "8px 12px" })}><IconBox /> Optimize Trucks</button>
          </div>}

          {/* Fill items added */}
          <div style={Object.assign({}, S.card, { marginTop: 0 })}>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Added from Fill ({fillAdded.length})</div>
            {fillAdded.length === 0 && <div style={{ fontSize: 12, color: "#D1D5DB", textAlign: "center", padding: "12px 0" }}>No fill items added yet</div>}
            {fillAdded.map(function(a) {
              return <div key={a.productCode} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{a.productCode}</div>
                  <div style={{ fontSize: 10, color: "#9CA3AF" }}>{a.orderQty} qty {"\u00B7"} {a.totalLbs.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  <button onClick={function() { updateFillPallets(a.productCode, a.pallets - 1); }} disabled={a.pallets <= 1} style={{ background: "#F3F4F6", border: "none", borderRadius: 4, width: 20, height: 20, fontSize: 13, fontWeight: 700, cursor: a.pallets <= 1 ? "default" : "pointer", color: a.pallets <= 1 ? "#D1D5DB" : "#374151", display: "flex", alignItems: "center", justifyContent: "center" }}>{"\u2212"}</button>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", minWidth: 18, textAlign: "center" }}>{a.pallets}</span>
                  <button onClick={function() { updateFillPallets(a.productCode, a.pallets + 1); }} style={{ background: "#F3F4F6", border: "none", borderRadius: 4, width: 20, height: 20, fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#374151", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                  <button onClick={function() { removeFillItem(a.productCode); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#DC2626", fontSize: 13, padding: "2px 4px", marginLeft: 4 }}>{"\u2715"}</button>
                </div>
              </div>;
            })}
            {fillAdded.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600 }}>
              <span style={{ color: "#6B7280" }}>Fill weight:</span>
              <span style={{ color: "#059669" }}>+{fillAdded.reduce(function(s, a) { return s + a.totalLbs; }, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs</span>
            </div>}
          </div>
        </div>
      </div>}
      {fillSuggestions && fillSuggestions.length === 0 && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 40, color: "#9CA3AF" })}>No fill candidates found for {warehouse}.</div>}
    </div>}

    {/* EMAIL DRAFTS */}
    {step === "email" && <div>
      {(function() {
        var whMeta = WH_META[warehouse] || { shortCode: warehouse, cpTo: "jcanter@centralpet.com, jspengler@central.com, hd-purchaseorders@vetcove.com" };
        var whShort = whMeta.shortCode;
        var now = new Date();
        var dateStr = (now.getMonth() + 1) + "." + ("0" + now.getDate()).slice(-2) + "." + now.getFullYear();
        var subject = dateStr + " Weekly Replenishment - Vetcove " + whShort;
        var defaultHillsTo = "truckloador@hillspet.com, brian_shively@hillspet.com, hd-purchaseorders@vetcove.com";
        var whOverrides = emailOverrides[warehouse] || {};
        var hillsTo = whOverrides.hillsTo != null ? whOverrides.hillsTo : defaultHillsTo;
        var hillsCc = whOverrides.hillsCc != null ? whOverrides.hillsCc : "";
        var cpTo = whOverrides.cpTo != null ? whOverrides.cpTo : whMeta.cpTo;
        var cpCc = whOverrides.cpCc != null ? whOverrides.cpCc : "";
        function saveEmailOverride(field, value) {
          var updated = Object.assign({}, emailOverrides);
          updated[warehouse] = Object.assign({}, updated[warehouse] || {}, {});
          updated[warehouse][field] = value;
          setEmailOverrides(updated);
          kvPost("truckloader-email-overrides", updated).catch(function() {});
        }
        var hillsBody = "<p>Hi, please find attached our weekly replenishment order. Please include the Purchase Order # on our packing list.</p><p>We look forward to confirmation of receipt. Let us know if you have any questions.</p><p>Thanks,</p>";
        var cpBody = "<p>Hi Central Pet team,</p><p>I've just placed this week's replenishment POs with Hill's. Attaching here to create in your systems. Hill's hasn't set delivery appointments yet.</p><p>Thanks,</p>";

        async function createDraft(type) {
          if (!gmail || !gmail.token) { toast("Connect Gmail first (bottom-left)", "error"); return; }
          try {
            var payload = type === "hills"
              ? { to: hillsTo, cc: hillsCc, subject: subject, htmlBody: hillsBody, attachments: [] }
              : { to: cpTo, cc: cpCc, subject: subject, htmlBody: cpBody, attachments: [] };
            var result = await postGmailDrafts([payload], gmail.token);
            if (result.failed > 0) throw new Error("Draft creation failed");
            if (type === "hills") setHillsDraftSent(true); else setCpDraftSent(true);
            toast((type === "hills" ? "Hill's" : "Central Pet") + " draft created!");
          } catch (err) { toast("Gmail error: " + err.message, "error"); }
        }

        return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={Object.assign({}, S.card, { borderLeft: "4px solid " + TOOL_COLOR })}>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>{warehouse}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}><strong>Subject:</strong> {subject}</div>
          </div>

          {/* Hill's Draft */}
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1F2937", marginBottom: 8 }}>Hill{"'"}s Pet Nutrition</div>

                {/* To row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, minWidth: 26, paddingTop: 1 }}>To:</span>
                  <div style={{ flex: 1, minWidth: 0 }}>{editingEmail === "hills" ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea value={emailEditValue} onChange={function(e) { setEmailEditValue(e.target.value); }} autoFocus onKeyDown={function(e) { if (e.key === "Escape") setEditingEmail(null); }} placeholder="recipient1@example.com, recipient2@example.com" rows={2} style={Object.assign({}, S.inp, { padding: "8px 12px", fontSize: 13, lineHeight: 1.5, color: "#374151", width: "100%", resize: "vertical", fontFamily: "'Varela Round', sans-serif" })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={function() { saveEmailOverride("hillsTo", emailEditValue); setEditingEmail(null); }} style={Object.assign({}, S.btn(), { padding: "5px 14px", fontSize: 11 })}>Save</button>
                      <button onClick={function() { setEditingEmail(null); }} style={Object.assign({}, S.btn("ghost"), { padding: "5px 14px", fontSize: 11 })}>Cancel</button>
                    </div>
                  </div> : <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 11, color: "#9CA3AF", wordBreak: "break-all", flex: 1 }}>{hillsTo}</span><button onClick={function() { setEmailEditValue(hillsTo); setEditingEmail("hills"); }} title="Edit To recipients" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 12, padding: 2, flexShrink: 0 }}>{"\u270E"}</button></div>}</div>
                </div>

                {/* Cc row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, minWidth: 26, paddingTop: 1 }}>Cc:</span>
                  <div style={{ flex: 1, minWidth: 0 }}>{editingEmail === "hills-cc" ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea value={emailEditValue} onChange={function(e) { setEmailEditValue(e.target.value); }} autoFocus onKeyDown={function(e) { if (e.key === "Escape") setEditingEmail(null); }} placeholder="cc1@example.com, cc2@example.com (optional)" rows={2} style={Object.assign({}, S.inp, { padding: "8px 12px", fontSize: 13, lineHeight: 1.5, color: "#374151", width: "100%", resize: "vertical", fontFamily: "'Varela Round', sans-serif" })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={function() { saveEmailOverride("hillsCc", emailEditValue); setEditingEmail(null); }} style={Object.assign({}, S.btn(), { padding: "5px 14px", fontSize: 11 })}>Save</button>
                      <button onClick={function() { setEditingEmail(null); }} style={Object.assign({}, S.btn("ghost"), { padding: "5px 14px", fontSize: 11 })}>Cancel</button>
                    </div>
                  </div> : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{hillsCc ? <span style={{ fontSize: 11, color: "#9CA3AF", wordBreak: "break-all", flex: 1 }}>{hillsCc}</span> : <span style={{ fontSize: 11, color: "#9CA3AF", fontStyle: "italic", flex: 1 }}>no CC set</span>}<button onClick={function() { setEmailEditValue(hillsCc); setEditingEmail("hills-cc"); }} title="Edit Cc recipients" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 12, padding: 2, flexShrink: 0 }}>{"\u270E"}</button></div>}</div>
                </div>
              </div>
              {hillsDraftSent && <span style={{ fontSize: 11, color: "#059669", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><IconCheck /> Sent</span>}
            </div>
            <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "14px 16px", fontSize: 13, color: "#374151", lineHeight: 1.7, marginBottom: 12 }}>
              Hi, please find attached our weekly replenishment order. Please include the Purchase Order # on our packing list.<br /><br />
              We look forward to confirmation of receipt. Let us know if you have any questions.<br /><br />
              Thanks,<br /><br />
              <span style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic" }}>Your Vetcove Gmail signature will be appended automatically</span>
            </div>
            <button onClick={function() { createDraft("hills"); }} disabled={hillsDraftSent} style={Object.assign({}, S.btn(), { opacity: hillsDraftSent ? 0.5 : 1 })}><IconMail /> {hillsDraftSent ? "Draft Created" : "Create Draft for Hill\u2019s"}</button>
          </div>

          {/* Central Pet Draft */}
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1F2937", marginBottom: 8 }}>Central Pet</div>

                {/* To row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, minWidth: 26, paddingTop: 1 }}>To:</span>
                  <div style={{ flex: 1, minWidth: 0 }}>{editingEmail === "cp" ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea value={emailEditValue} onChange={function(e) { setEmailEditValue(e.target.value); }} autoFocus onKeyDown={function(e) { if (e.key === "Escape") setEditingEmail(null); }} placeholder="recipient1@example.com, recipient2@example.com" rows={2} style={Object.assign({}, S.inp, { padding: "8px 12px", fontSize: 13, lineHeight: 1.5, color: "#374151", width: "100%", resize: "vertical", fontFamily: "'Varela Round', sans-serif" })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={function() { saveEmailOverride("cpTo", emailEditValue); setEditingEmail(null); }} style={Object.assign({}, S.btn(), { padding: "5px 14px", fontSize: 11 })}>Save</button>
                      <button onClick={function() { setEditingEmail(null); }} style={Object.assign({}, S.btn("ghost"), { padding: "5px 14px", fontSize: 11 })}>Cancel</button>
                    </div>
                  </div> : <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 11, color: "#9CA3AF", wordBreak: "break-all", flex: 1 }}>{cpTo}</span><button onClick={function() { setEmailEditValue(cpTo); setEditingEmail("cp"); }} title="Edit To recipients" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 12, padding: 2, flexShrink: 0 }}>{"\u270E"}</button></div>}</div>
                </div>

                {/* Cc row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, minWidth: 26, paddingTop: 1 }}>Cc:</span>
                  <div style={{ flex: 1, minWidth: 0 }}>{editingEmail === "cp-cc" ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea value={emailEditValue} onChange={function(e) { setEmailEditValue(e.target.value); }} autoFocus onKeyDown={function(e) { if (e.key === "Escape") setEditingEmail(null); }} placeholder="cc1@example.com, cc2@example.com (optional)" rows={2} style={Object.assign({}, S.inp, { padding: "8px 12px", fontSize: 13, lineHeight: 1.5, color: "#374151", width: "100%", resize: "vertical", fontFamily: "'Varela Round', sans-serif" })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={function() { saveEmailOverride("cpCc", emailEditValue); setEditingEmail(null); }} style={Object.assign({}, S.btn(), { padding: "5px 14px", fontSize: 11 })}>Save</button>
                      <button onClick={function() { setEditingEmail(null); }} style={Object.assign({}, S.btn("ghost"), { padding: "5px 14px", fontSize: 11 })}>Cancel</button>
                    </div>
                  </div> : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{cpCc ? <span style={{ fontSize: 11, color: "#9CA3AF", wordBreak: "break-all", flex: 1 }}>{cpCc}</span> : <span style={{ fontSize: 11, color: "#9CA3AF", fontStyle: "italic", flex: 1 }}>no CC set</span>}<button onClick={function() { setEmailEditValue(cpCc); setEditingEmail("cp-cc"); }} title="Edit Cc recipients" style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 12, padding: 2, flexShrink: 0 }}>{"\u270E"}</button></div>}</div>
                </div>
              </div>
              {cpDraftSent && <span style={{ fontSize: 11, color: "#059669", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><IconCheck /> Sent</span>}
            </div>
            <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "14px 16px", fontSize: 13, color: "#374151", lineHeight: 1.7, marginBottom: 12 }}>
              Hi Central Pet team,<br /><br />
              I{"'"}ve just placed this week{"'"}s replenishment POs with Hill{"'"}s. Attaching here to create in your systems. Hill{"'"}s hasn{"'"}t set delivery appointments yet.<br /><br />
              Thanks,<br /><br />
              <span style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic" }}>Your Vetcove Gmail signature will be appended automatically</span>
            </div>
            <button onClick={function() { createDraft("cp"); }} disabled={cpDraftSent} style={Object.assign({}, S.btn(), { opacity: cpDraftSent ? 0.5 : 1 })}><IconMail /> {cpDraftSent ? "Draft Created" : "Create Draft for Central Pet"}</button>
          </div>
        </div>;
      })()}
    </div>}

    {/* EMPTY STATE */}
    {orderItems.length === 0 && !replenLoading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}>
      <IconBox /><br /><br />
      {hillsMaster ? "Select warehouse and click Fetch Replenishment to load items." : "Upload Hills Master XLSX to get started."}
    </div>}

    {/* Confirm Remove Modal */}
    {confirmRemove && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={function() { setConfirmRemove(null); }}>
      <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 32, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", animation: "slideUp 0.2s ease" }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(245,158,11,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1F2937", textAlign: "center", margin: "0 0 8px" }}>Remove Replenishment Item</h3>
        <p style={{ fontSize: 13, color: "#6B7280", textAlign: "center", margin: "0 0 24px", lineHeight: 1.6 }}>Item <strong style={{ color: "#D97706", fontFamily: "monospace" }}>{confirmRemove.id}</strong> came from Prepare Replenishment. Removing it means it won{"'"}t be included in the order or any truck assignments.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={function() { setConfirmRemove(null); }} style={{ flex: 1, padding: "10px 16px", borderRadius: 10, border: "1px solid #E5E7EB", background: "#FFFFFF", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={function() { confirmRemove.action(); }} style={{ flex: 1, padding: "10px 16px", borderRadius: 10, border: "none", background: "#DC2626", color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Remove Item</button>
        </div>
      </div>
    </div>}
  </div>;
}

/* ═══════ OOS TRACKER ═══════ */
function OOSTracker(props) {
  var toast = props.toast, cred = props.cred;
  var TOOL_COLOR = "#EF4444";
  var _tab = useState("fuzerx"), tab = _tab[0], setTab = _tab[1];
  var _orderMap = useState({}), orderMap = _orderMap[0], setOrderMap = _orderMap[1];
  var _orderMapLastFetched = useState(null), orderMapLastFetched = _orderMapLastFetched[0], setOrderMapLastFetched = _orderMapLastFetched[1];
  var _orderMapLoading = useState(false), orderMapLoading = _orderMapLoading[0], setOrderMapLoading = _orderMapLoading[1];
  var _orderMapCacheHit = useState(false), orderMapCacheHit = _orderMapCacheHit[0], setOrderMapCacheHit = _orderMapCacheHit[1];
  function normalizeNdc(s) { return (s || "").replace(/\D/g, ""); }
  // Which Acumatica warehouses (and which Google Sheets) are relevant per OOS tab
  var TAB_WAREHOUSES = { fuzerx: ["TP-NY", "TP-OH", "TP-CA"], gogomeds: ["GGM-KY", "GGM-AZ"], cgp: [] };
  function loadOrderMap(forceFresh) {
    var whsForTab = TAB_WAREHOUSES[tab] || [];
    setOrderMapLoading(true);
    var refreshParam = forceFresh ? "?refresh=1" : "";
    var sheetPromise = Promise.all(whsForTab.map(function(wh) {
      return fetch("/api/sheets?wh=" + encodeURIComponent(wh) + "&_t=" + Date.now(), { cache: "no-store" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(j) { return { wh: wh, rows: (j && j.data) || [] }; })
        .catch(function() { return { wh: wh, rows: [] }; });
    }));
    var openPoPromise = (cred && cred.username && cred.password)
      ? fetch("/api/acumatica" + refreshParam, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "open-po-lines", username: cred.username, password: cred.password }),
        }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      : Promise.resolve(null);
    var hillsMetaPromise = kvGet("hills-pawtree-meta").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    // NDC <-> Inventory ID cross-reference (only needed for tabs that use sheets)
    var needsNdcLookup = whsForTab.length > 0 && cred && cred.username && cred.password;
    var crossRefPromise = needsNdcLookup
      ? fetch("/api/acumatica", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "stock-cross-ref", username: cred.username, password: cred.password }) }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      : Promise.resolve(null);
    var ndcLookupPromise = needsNdcLookup
      ? fetch("/api/acumatica", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ndc-lookup", username: cred.username, password: cred.password }) }).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      : Promise.resolve(null);
    function parseDateLoose(s) {
      if (!s) return null;
      var t = String(s).split("T")[0];
      var iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])).getTime();
      var us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (us) { var y = parseInt(us[3]); if (y < 100) y += 2000; return new Date(y, parseInt(us[1]) - 1, parseInt(us[2])).getTime(); }
      var d = new Date(t); return isNaN(d.getTime()) ? null : d.getTime();
    }
    Promise.all([sheetPromise, openPoPromise, hillsMetaPromise, crossRefPromise, ndcLookupPromise]).then(function(all) {
      var sheetResults = all[0];
      var openPoJson = all[1];
      var hillsMetaResp = all[2];
      var crossRefJson = all[3];
      var ndcLookupJson = all[4];
      // Build NDC -> [Inventory IDs] map (branded + GEN- can both map to same NDC)
      var ndcToInvIds = {};
      // Reverse: Inventory ID -> NDC (used so we can look up an Acumatica PO's NDC)
      var invIdToNdc = {};
      function addNdcMapping(ndc, invId) {
        if (!ndc || !invId) return;
        if (!ndcToInvIds[ndc]) ndcToInvIds[ndc] = [];
        if (ndcToInvIds[ndc].indexOf(invId) < 0) ndcToInvIds[ndc].push(invId);
        if (!invIdToNdc[invId]) invIdToNdc[invId] = ndc;
      }
      if (crossRefJson && crossRefJson.data) {
        crossRefJson.data.forEach(function(row) {
          addNdcMapping(normalizeNdc(row.NDC), (row.InventoryID || "").trim());
        });
      }
      if (ndcLookupJson && ndcLookupJson.data) {
        ndcLookupJson.data.forEach(function(row) {
          addNdcMapping(normalizeNdc(row.AlternateID), (row.InventoryID || "").trim());
        });
      }
      // Build tracker proximity map, dual-keyed under (sheet Inventory ID) + (NDC-resolved Inventory IDs) + (raw NDC fallback)
      // Each entry stores `source` so we can attribute the ETA in the UI.
      var trackerByInvId = {};
      sheetResults.forEach(function(rs) {
        var sourceLabel = rs.wh.indexOf("TP-") === 0 ? "Fuze" : (rs.wh.indexOf("GGM-") === 0 ? "GGM" : "Sheet");
        rs.rows.forEach(function(r) {
          var eta = r["Expected Arrival"] || "";
          if (!eta) return;
          var orderDate = r["Order Date"] || "";
          var orderDateMs = parseDateLoose(orderDate);
          var sheetInvId = (r["Inventory ID"] || "").trim();
          var sheetNdc = normalizeNdc(r["NDC"]);
          // Collect every key this row should be indexed under
          var keys = [];
          if (sheetInvId) keys.push(sheetInvId);
          if (sheetNdc && ndcToInvIds[sheetNdc]) {
            ndcToInvIds[sheetNdc].forEach(function(id) { if (keys.indexOf(id) < 0) keys.push(id); });
          }
          if (sheetNdc) keys.push("NDC:" + sheetNdc);
          if (keys.length === 0) return;
          var entry = { eta: eta, orderDateMs: orderDateMs, source: sourceLabel };
          keys.forEach(function(key) {
            if (!trackerByInvId[key]) trackerByInvId[key] = [];
            trackerByInvId[key].push(entry);
          });
        });
      });
      // Hills KV meta: { "P0001234": { eta: "5/15/2026", notes: "..." } }
      var hillsMeta = {};
      if (hillsMetaResp && hillsMetaResp.data) {
        var raw = typeof hillsMetaResp.data === "string" ? JSON.parse(hillsMetaResp.data) : hillsMetaResp.data;
        Object.keys(raw || {}).forEach(function(po) {
          if (raw[po] && raw[po].eta) hillsMeta[po] = raw[po].eta;
        });
      }
      // Find best tracker entry for a given Acumatica PO's Inventory ID + Order Date
      function bestTrackerEta(invId, orderDateMs) {
        // Try keys in priority order: direct Inventory ID, then NDC-resolved (via reverse map)
        var candidates = trackerByInvId[invId] || [];
        if (candidates.length === 0) {
          var ndc = invIdToNdc[invId];
          if (ndc) candidates = trackerByInvId["NDC:" + ndc] || [];
        }
        if (candidates.length === 0 || !orderDateMs) return null;
        var best = null, bestDelta = Infinity;
        candidates.forEach(function(t) {
          if (!t.orderDateMs) return;
          var delta = Math.abs(t.orderDateMs - orderDateMs);
          if (delta < bestDelta && delta <= 14 * 86400000) { bestDelta = delta; best = t; }
        });
        return best;
      }
      // Build final map from Open PO Lines, enriched with ETA where possible
      var map = {};
      if (openPoJson && openPoJson.data) {
        openPoJson.data.forEach(function(row) {
          var invId = (row.InventoryID || "").trim();
          if (!invId) return;
          var whCode = (row.Warehouse || "").trim();
          // Skip warehouses we don't work with (e.g. EXP-NJ and any other EXP- prefixed)
          if (whCode.indexOf("EXP") === 0) return;
          var orderQty = parseFloat(row.OrderQty) || 0;
          var qtyReceived = parseFloat(row.QtyOnReceipts) || 0;
          var outstanding = orderQty - qtyReceived;
          var po = (row.OrderNbr || "").trim();
          var orderDate = row.OrderDate || "";
          var orderDateMs = parseDateLoose(orderDate);
          // ETA resolution priority:
          // 1) Hills KV (matches by Acumatica PO# directly)
          // 2) Tracker sheet (matches by Inventory ID or NDC-resolved Inventory ID, within 14 days of Order Date)
          var eta = "";
          var etaSource = "";
          if (po && hillsMeta[po]) {
            eta = hillsMeta[po];
            etaSource = "Hills KV";
          } else {
            var best = bestTrackerEta(invId, orderDateMs);
            if (best) { eta = best.eta; etaSource = best.source; }
          }
          if (!map[invId]) map[invId] = [];
          map[invId].push({
            wh: row.Warehouse || "",
            po: po,
            orderDate: orderDate,
            expectedArrival: eta,
            etaSource: etaSource,
            orderQty: orderQty,
            qtyReceived: qtyReceived,
            received: outstanding <= 0,
          });
        });
      }
      setOrderMap(map);
      var ts = (openPoJson && openPoJson._cachedAt) || Date.now();
      setOrderMapLastFetched(ts);
      setOrderMapCacheHit(openPoJson && openPoJson._cache === "hit");
      setOrderMapLoading(false);
    });
  }
  useEffect(function() { loadOrderMap(false); }, [cred, tab]);
  var _fuzeData = useState([]), fuzeData = _fuzeData[0], setFuzeData = _fuzeData[1];
  var _ggmData = useState([]), ggmData = _ggmData[0], setGgmData = _ggmData[1];
  var _cgpData = useState([]), cgpData = _cgpData[0], setCgpData = _cgpData[1];
  var _fuzeName = useState(null), fuzeName = _fuzeName[0], setFuzeName = _fuzeName[1];
  var _ggmName = useState(null), ggmName = _ggmName[0], setGgmName = _ggmName[1];
  var _cgpName = useState(null), cgpName = _cgpName[0], setCgpName = _cgpName[1];
  var _search = useState(""), search = _search[0], setSearch = _search[1];
  var _whFilter = useState("all"), whFilter = _whFilter[0], setWhFilter = _whFilter[1];
  var _sort = useState({ col: "warehouse", dir: "asc" }), sortState = _sort[0], setSortState = _sort[1];
  var _notes = useState({}), notes = _notes[0], setNotes = _notes[1];
  var _notesLoaded = useState(false), notesLoaded = _notesLoaded[0], setNotesLoaded = _notesLoaded[1];
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);
  var OOS_KV_KEY = "oos-notes-shared";
  var OOS_DATA_KEY = "oos-data-shared";
  var OOS_NOTES_PERM_KEY = "oos-notes-permanent";
  var OOS_NOTES_MISS_KEY = "oos-notes-misscount";
  var NOTE_EXPIRY_MISSES = 7; // Note clears when item has been missing from this many uploads in a row
  // Legacy keys (read-only, for one-time migration of surviving notes)
  var OOS_PNOTES_KEY = "oos-persistent-notes";
  var OOS_PREV_NOTES_KEY = "oos-previous-notes";
  var OOS_PREV_ITEMS_KEY = "oos-previous-items";
  var _permNotes = useState({}), permNotes = _permNotes[0], setPermNotes = _permNotes[1];
  var _missCount = useState({}), missCount = _missCount[0], setMissCount = _missCount[1];
  var _prevItems = useState({}), prevItems = _prevItems[0], setPrevItems = _prevItems[1];

  function getDailyReset() {
    var now = new Date();
    var et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    var day = et.getDay(); // 0=Sun, 1=Mon, 6=Sat
    // Find the most recent weekday 5am reset
    var reset = new Date(et); reset.setHours(5, 0, 0, 0);
    if (et < reset) reset.setDate(reset.getDate() - 1);
    // Walk back past weekends
    while (reset.getDay() === 0 || reset.getDay() === 6) {
      reset.setDate(reset.getDate() - 1);
    }
    return reset.getTime();
  }

  useEffect(function() {
    var m = true;
    // Load notes
    kvGet(OOS_KV_KEY).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m) return;
      if (d && d.data) {
        var parsed = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
        var savedAt = parsed._savedAt || 0;
        var resetTime = getDailyReset();
        if (savedAt < resetTime) { setNotes({}); kvPost(OOS_KV_KEY, { _savedAt: Date.now() }); }
        else { delete parsed._savedAt; setNotes(parsed); }
      }
      setNotesLoaded(true);
    }).catch(function() { setNotesLoaded(true); });
    // Load CSV data
    kvGet(OOS_DATA_KEY).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m || !d || !d.data) return;
      var parsed = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
      var resetTime = getDailyReset();
      if (parsed._savedAt && parsed._savedAt < resetTime) {
        // Save manufacturer numbers as previous items before wiping
        var prevIds = {};
        if (parsed.fuze) parsed.fuze.forEach(function(r) { prevIds["fuzerx:" + r.MANUFACTURER_NO] = true; });
        if (parsed.ggm) parsed.ggm.forEach(function(r) { prevIds["gogomeds:" + r.MANUFACTURER_NO] = true; });
        if (parsed.cgp) parsed.cgp.forEach(function(r) { prevIds["cgp:" + r.MANUFACTURER_NO] = true; });
        // Only rotate prevItems if current data actually has rows — otherwise keep whatever's already in prev
        if (Object.keys(prevIds).length > 0) {
          kvPost(OOS_PREV_ITEMS_KEY, prevIds);
          setPrevItems(prevIds);
        }
        kvPost(OOS_DATA_KEY, { _savedAt: Date.now() });
        return;
      }
      if (parsed.fuze && parsed.fuze.length > 0) { setFuzeData(parsed.fuze); setFuzeName(parsed.fuzeName || "Loaded from cloud"); }
      if (parsed.ggm && parsed.ggm.length > 0) { setGgmData(parsed.ggm); setGgmName(parsed.ggmName || "Loaded from cloud"); }
      if (parsed.cgp && parsed.cgp.length > 0) { setCgpData(parsed.cgp); setCgpName(parsed.cgpName || "Loaded from cloud"); }
    }).catch(function() {});
    // Load previous items
    kvGet(OOS_PREV_ITEMS_KEY).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m || !d || !d.data) return;
      var parsed = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
      setPrevItems(parsed);
    }).catch(function() {});
    // Load permanent notes + miss count map. On very first run (perm key doesn't exist), do a
    // one-time migration from the old pNotes + prevNotes buckets so surviving notes carry over.
    // No time-based sweep — miss count only changes when a new CSV is uploaded.
    Promise.all([
      kvGet(OOS_NOTES_PERM_KEY).then(function(r) { return r.ok ? r.json() : null; }),
      kvGet(OOS_PNOTES_KEY).then(function(r) { return r.ok ? r.json() : null; }),
      kvGet(OOS_PREV_NOTES_KEY).then(function(r) { return r.ok ? r.json() : null; }),
      kvGet(OOS_NOTES_MISS_KEY).then(function(r) { return r.ok ? r.json() : null; })
    ]).then(function(results) {
      if (!m) return;
      var permRaw = results[0] && results[0].data ? (typeof results[0].data === "string" ? JSON.parse(results[0].data) : results[0].data) : null;
      var missRaw = results[3] && results[3].data ? (typeof results[3].data === "string" ? JSON.parse(results[3].data) : results[3].data) : {};
      delete missRaw._savedAt;
      if (permRaw && Object.keys(permRaw).filter(function(k) { return k !== "_savedAt"; }).length > 0) {
        // Already migrated — just load
        delete permRaw._savedAt;
        setPermNotes(permRaw);
      } else {
        // First-ever load — merge from legacy buckets
        var legacyPrev = results[2] && results[2].data ? (typeof results[2].data === "string" ? JSON.parse(results[2].data) : results[2].data) : {};
        var legacyCur = results[1] && results[1].data ? (typeof results[1].data === "string" ? JSON.parse(results[1].data) : results[1].data) : {};
        delete legacyPrev._savedAt; delete legacyCur._savedAt;
        var merged = Object.assign({}, legacyPrev, legacyCur);
        setPermNotes(merged);
        // Seed missCount = 0 for migrated notes
        Object.keys(merged).forEach(function(k) { if (missRaw[k] === undefined) missRaw[k] = 0; });
        kvPost(OOS_NOTES_PERM_KEY, Object.assign({}, merged, { _savedAt: Date.now() })).catch(function() {});
        kvPost(OOS_NOTES_MISS_KEY, Object.assign({}, missRaw, { _savedAt: Date.now() })).catch(function() {});
      }
      setMissCount(missRaw);
    }).catch(function() {});
    return function() { m = false; };
  }, []);

  useEffect(function() {
    var iv = setInterval(function() {
      kvGet(OOS_KV_KEY).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
        if (d && d.data) {
          var parsed = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
          delete parsed._savedAt; setNotes(parsed);
        }
      }).catch(function() {});
      kvGet(OOS_NOTES_PERM_KEY).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
        if (d && d.data) {
          var parsed = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
          delete parsed._savedAt; setPermNotes(parsed);
        }
      }).catch(function() {});
    }, 8000);
    return function() { clearInterval(iv); };
  }, []);

  var WH_MAP = { "TRUEPILL_BROOKLYN": "Brooklyn", "TRUEPILL_OHIO": "Ohio", "TRUEPILL_HAYWARD": "Hayward", "TRUEPILL_MIAMI": "Miami", "GOGOMEDS_KY": "Kentucky", "GOGOMEDS_AZ": "Arizona", "GOGOMEDS_KENTUCKY": "Kentucky", "GOGOMEDS_ARIZONA": "Arizona", "HILLS_CGP_WAREHOUSE_CA": "Hills CA", "HILLS_CGP_WAREHOUSE_NJ": "Hills NJ", "HILLS_CGP_WAREHOUSE_FL": "Hills FL", "HILLS_CGP_WAREHOUSE_TX": "Hills TX" };
  function mapWH(slug) { return WH_MAP[slug] || slug || "\u2014"; }

  function updateNote(key, field, value) {
    if (field === "note") {
      // Permanent notes — no rotation, persist indefinitely
      var pu = Object.assign({}, permNotes); pu[key] = value; setPermNotes(pu);
      kvPost(OOS_NOTES_PERM_KEY, Object.assign({}, pu, { _savedAt: Date.now() })).catch(function() {});
    } else {
      // SD/BO go to daily-reset storage
      var u = Object.assign({}, notes); u[key] = Object.assign({}, u[key] || {}); u[key][field] = value; setNotes(u);
      var toSave = Object.assign({}, u, { _savedAt: Date.now() }); kvPost(OOS_KV_KEY, toSave).catch(function() {});
    }
  }

  function parseCSV(text) {
    var lines = text.split("\n").filter(function(l) { return l.trim(); });
    if (lines.length < 2) return [];
    var headers = lines[0].split(",").map(function(h) { return h.trim().replace(/^"|"$/g, ""); });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var vals = []; var cur = ""; var inQuote = false;
      for (var c = 0; c < lines[i].length; c++) { var ch = lines[i][c]; if (ch === '"') { inQuote = !inQuote; } else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ""; } else { cur += ch; } }
      vals.push(cur.trim());
      var obj = {}; headers.forEach(function(h, hi) { obj[h] = vals[hi] || ""; }); obj._wh = mapWH(obj.WAREHOUSE_SLUG || ""); rows.push(obj);
    }
    return rows;
  }

  function saveDataToKV(fuze, fuzeFn, ggm, ggmFn, cgp, cgpFn) {
    kvPost(OOS_DATA_KEY, { fuze: fuze, fuzeName: fuzeFn, ggm: ggm, ggmName: ggmFn, cgp: cgp, cgpName: cgpFn, _savedAt: Date.now() }).catch(function() {});
  }

  function applyUploadToMissCount(rows, vendorTab) {
    // For every note key in this vendor tab:
    //   - If item is in this upload: reset miss count to 0
    //   - If item is NOT in this upload: miss count += 1
    //   - If miss count >= NOTE_EXPIRY_MISSES: clear the note
    var prefix = vendorTab + ":";
    var seenKeys = {};
    (rows || []).forEach(function(r) {
      seenKeys[vendorTab + ":" + r.MANUFACTURER_NO + ":" + (r.WAREHOUSE_SLUG || "")] = true;
    });
    var newMiss = Object.assign({}, missCount);
    var newNotes = Object.assign({}, permNotes);
    var notesChanged = false;
    Object.keys(newNotes).forEach(function(k) {
      if (k.indexOf(prefix) !== 0) return; // only touch keys for the vendor we just uploaded
      if (seenKeys[k]) {
        newMiss[k] = 0;
      } else {
        var c = (newMiss[k] || 0) + 1;
        if (c >= NOTE_EXPIRY_MISSES) {
          delete newNotes[k];
          delete newMiss[k];
          notesChanged = true;
        } else {
          newMiss[k] = c;
        }
      }
    });
    // Also initialize missCount = 0 for new keys in this upload (items with no note yet)
    Object.keys(seenKeys).forEach(function(k) { if (newMiss[k] === undefined) newMiss[k] = 0; });
    setMissCount(newMiss);
    var now = Date.now();
    kvPost(OOS_NOTES_MISS_KEY, Object.assign({}, newMiss, { _savedAt: now })).catch(function() {});
    if (notesChanged) {
      setPermNotes(newNotes);
      kvPost(OOS_NOTES_PERM_KEY, Object.assign({}, newNotes, { _savedAt: now })).catch(function() {});
    }
  }

  function handleFile(file, vendor) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var rows = parseCSV(e.target.result);
      if (vendor === "fuzerx") { setFuzeData(rows); setFuzeName(file.name); saveDataToKV(rows, file.name, ggmData, ggmName, cgpData, cgpName); }
      else if (vendor === "cgp") { setCgpData(rows); setCgpName(file.name); saveDataToKV(fuzeData, fuzeName, ggmData, ggmName, rows, file.name); }
      else { setGgmData(rows); setGgmName(file.name); saveDataToKV(fuzeData, fuzeName, rows, file.name, cgpData, cgpName); }
      applyUploadToMissCount(rows, vendor);
      setWhFilter("all"); setSearch("");
      toast("Loaded " + rows.length + " OOS items from " + file.name);
    };
    reader.readAsText(file);
  }

  function uploadZone(vendor) {
    var label = vendor === "fuzerx" ? "FuzeRx" : vendor === "cgp" ? "Central Garden & Pet" : "GoGoMeds";
    return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 40 })}>
      <div onDragOver={function(e) { e.preventDefault(); }} onDrop={function(e) { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], vendor); }} style={{ border: "2px dashed #E5E7EB", borderRadius: 12, padding: 40, cursor: "pointer" }} onClick={function() { var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".csv"; inp.onchange = function(e) { handleFile(e.target.files[0], vendor); }; inp.click(); }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{"\uD83D\uDCC4"}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Upload {label} OOS CSV</div>
        <div style={{ fontSize: 12, color: "#9CA3AF" }}>Drag and drop or click to browse</div>
      </div>
    </div>;
  }

  var data = tab === "fuzerx" ? fuzeData : tab === "cgp" ? cgpData : ggmData;
  var currentName = tab === "fuzerx" ? fuzeName : tab === "cgp" ? cgpName : ggmName;
  var _sdIds = useState({}), sdIds = _sdIds[0], setSdIds = _sdIds[1];
  useEffect(function() {
    // Try localStorage first
    var cached = sGet("tracker-short-dating");
    if (cached && cached.data && cached.data.length > 0) {
      var ids = {}; cached.data.forEach(function(r) { if (r.InventoryID) ids[String(r.InventoryID)] = true; }); setSdIds(ids);
    }
    // Then try KV for fresher data
    kvGet("tracker-shared-short-dating").then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (d && d.data && d.data.data && d.data.data.length > 0) {
        var ids = {}; d.data.data.forEach(function(r) { if (r.InventoryID) ids[String(r.InventoryID)] = true; }); setSdIds(ids);
        sSet("tracker-short-dating", d.data);
      }
    }).catch(function() {});
  }, []);
  var warehouses = useMemo(function() { var w = {}; data.forEach(function(r) { w[r._wh] = 1; }); return Object.keys(w).sort(); }, [data]);

  var filtered = useMemo(function() {
    var d = data.slice();
    if (whFilter !== "all") d = d.filter(function(r) { return r._wh === whFilter; });
    if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return (r.PRODUCT_LINE_NAME || "").toLowerCase().indexOf(s) >= 0 || (r.MANUFACTURER_NAME || "").toLowerCase().indexOf(s) >= 0 || (r.MANUFACTURER_NO || "").toLowerCase().indexOf(s) >= 0; }); }
    var col = sortState.col; var dir = sortState.dir;
    d.sort(function(a, b) { var va, vb; var nkA = tab + ":" + a.MANUFACTURER_NO + ":" + (a.WAREHOUSE_SLUG || ""); var nkB = tab + ":" + b.MANUFACTURER_NO + ":" + (b.WAREHOUSE_SLUG || ""); var nA = notes[nkA] || {}; var nB = notes[nkB] || {}; if (col === "warehouse") { va = a._wh; vb = b._wh; } else if (col === "manufacturer") { va = a.MANUFACTURER_NAME; vb = b.MANUFACTURER_NAME; } else if (col === "product") { va = a.PRODUCT_LINE_NAME; vb = b.PRODUCT_LINE_NAME; } else if (col === "status") { va = a.SUPPLY_STATUS; vb = b.SUPPLY_STATUS; } else if (col === "sd") { va = (nA.sd !== undefined ? nA.sd : sdIds[String(a.MANUFACTURER_NO)]) ? 1 : 0; vb = (nB.sd !== undefined ? nB.sd : sdIds[String(b.MANUFACTURER_NO)]) ? 1 : 0; return dir === "desc" ? vb - va : va - vb; } else if (col === "bo") { va = nA.bo ? 1 : 0; vb = nB.bo ? 1 : 0; return dir === "desc" ? vb - va : va - vb; } else if (col === "oos") { va = prevItems[tab + ":" + a.MANUFACTURER_NO] ? 1 : 0; vb = prevItems[tab + ":" + b.MANUFACTURER_NO] ? 1 : 0; return dir === "desc" ? vb - va : va - vb; } else { va = a.MANUFACTURER_NO; vb = b.MANUFACTURER_NO; } return dir === "desc" ? -(va || "").localeCompare(vb || "") : (va || "").localeCompare(vb || ""); });
    return d;
  }, [data, whFilter, search, sortState, notes, sdIds, prevItems]);

  function sortHeader(col, label) {
    var isSorted = sortState.col === col;
    return <th onClick={function() { setSortState(isSorted ? { col: col, dir: sortState.dir === "asc" ? "desc" : "asc" } : { col: col, dir: "asc" }); }} style={Object.assign({}, S.th, { cursor: "pointer", userSelect: "none" })}>{label}{isSorted ? (sortState.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>;
  }

  function dataTable() {
    return <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={Object.assign({}, S.statCard, { background: "#FEF2F2" })}><div style={{ fontSize: 11, color: "#C47070", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total OOS</div><div style={{ fontSize: 28, fontWeight: 500, color: "#EF4444", marginTop: 6 }}>{data.length}</div></div>
        {warehouses.map(function(wh) { var ct = data.filter(function(r) { return r._wh === wh; }).length; return <div key={wh} style={Object.assign({}, S.statCard, { background: "#F9FAFB" })}><div style={{ fontSize: 11, color: "#6B7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>{wh}</div><div style={{ fontSize: 28, fontWeight: 500, color: "#374151", marginTop: 6 }}>{ct}</div></div>; })}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search..." style={Object.assign({}, S.inp, { padding: "8px 14px", width: 200 })} />
        <select value={whFilter} onChange={function(e) { setWhFilter(e.target.value); }} style={Object.assign({}, S.sel, { padding: "8px 12px" })}><option value="all">All Warehouses</option>{warehouses.map(function(w) { return <option key={w} value={w}>{w}</option>; })}</select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#9CA3AF" }}>{filtered.length} of {data.length} items</span>
        <CacheStatus lastFetchedAt={orderMapLastFetched} cacheHit={orderMapCacheHit} refreshing={orderMapLoading} color={TOOL_COLOR} onRefresh={function() { loadOrderMap(true); }} />
        <button onClick={function() { if (tab === "fuzerx") { setFuzeData([]); setFuzeName(null); saveDataToKV([], null, ggmData, ggmName, cgpData, cgpName); } else if (tab === "cgp") { setCgpData([]); setCgpName(null); saveDataToKV(fuzeData, fuzeName, ggmData, ggmName, [], null); } else { setGgmData([]); setGgmName(null); saveDataToKV(fuzeData, fuzeName, [], null, cgpData, cgpName); } }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}><IconTrash /> Replace CSV</button>
      </div>
      <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr>
            <th style={Object.assign({}, S.th, { minWidth: 360 })}>Notes</th>
            {sortHeader("sd", "SD")}
            {sortHeader("bo", "BO")}
            {sortHeader("oos", "OOS")}
            {sortHeader("id", "Mfr No.")}
            {sortHeader("manufacturer", "Manufacturer")}
            {sortHeader("product", "Product")}
            {sortHeader("warehouse", "Warehouse")}
            <th style={Object.assign({}, S.th, { minWidth: 220 })}>Order Status</th>
          </tr></thead>
          <tbody>{filtered.map(function(r, i) {
            var noteKey = tab + ":" + r.MANUFACTURER_NO + ":" + (r.WAREHOUSE_SLUG || "");
            var n = notes[noteKey] || {};
            var autoSD = sdIds[String(r.MANUFACTURER_NO)] || false;
            var isSD = n.sd !== undefined ? n.sd : autoSD;
            var isOld = prevItems[tab + ":" + r.MANUFACTURER_NO];
            var whBg = r._wh === "Brooklyn" ? "#EFF6FF" : r._wh === "Ohio" ? "#ECFDF5" : r._wh === "Hayward" ? "#FFF7ED" : r._wh === "Miami" ? "#FFF1F2" : r._wh === "Kentucky" ? "#F5F3FF" : r._wh === "Arizona" ? "#FDF2F8" : r._wh === "Hills CA" ? "#FEF9C3" : r._wh === "Hills NJ" ? "#E0F2FE" : r._wh === "Hills FL" ? "#FFE4E6" : r._wh === "Hills TX" ? "#CCFBF1" : "#F3F4F6";
            var whColor = r._wh === "Brooklyn" ? "#2563EB" : r._wh === "Ohio" ? "#059669" : r._wh === "Hayward" ? "#D97706" : r._wh === "Miami" ? "#E11D48" : r._wh === "Kentucky" ? "#7C3AED" : r._wh === "Arizona" ? "#DB2777" : r._wh === "Hills CA" ? "#A16207" : r._wh === "Hills NJ" ? "#0369A1" : r._wh === "Hills FL" ? "#BE123C" : r._wh === "Hills TX" ? "#0F766E" : "#6B7280";
            return <tr key={i}>
              <td style={S.td}><textarea value={permNotes[noteKey] !== undefined ? permNotes[noteKey] : ""} onChange={function(e) { updateNote(noteKey, "note", e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }} placeholder="Add notes..." rows={1} style={Object.assign({}, S.inp, { padding: "5px 10px", fontSize: 12, resize: "none", overflow: "hidden", minHeight: 32, lineHeight: "1.4", display: "block", width: "100%" })} ref={function(el) { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }} /></td>
              <td style={Object.assign({}, S.td, { textAlign: "center" })}><button onClick={function() { updateNote(noteKey, "sd", !isSD); }} style={{ width: 20, height: 20, borderRadius: 4, border: isSD ? "2px solid #E879F9" : "2px solid #D1D5DB", background: isSD ? "#E879F9" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s" }}>{isSD && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}</button></td>
              <td style={Object.assign({}, S.td, { textAlign: "center" })}><button onClick={function() { updateNote(noteKey, "bo", !n.bo); }} style={{ width: 20, height: 20, borderRadius: 4, border: n.bo ? "2px solid #F97316" : "2px solid #D1D5DB", background: n.bo ? "#F97316" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s" }}>{n.bo && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}</button></td>
              <td style={Object.assign({}, S.td, { textAlign: "center" })}><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 600, background: isOld ? "#FFF7ED" : "#ECFDF5", color: isOld ? "#D97706" : "#059669" }}>{isOld ? "Old" : "New"}</span></td>
              <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "#374151" })}>{r.MANUFACTURER_NO}</td>
              <td style={Object.assign({}, S.td, { color: "#374151" })}>{r.MANUFACTURER_NAME}</td>
              <td style={Object.assign({}, S.td, { color: "#374151", maxWidth: 300 })}>{r.PRODUCT_LINE_NAME}</td>
              <td style={S.td}><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, fontWeight: 500, background: whBg, color: whColor }}>{r._wh}</span></td>
              <td style={S.td}>{(function() {
                // Map OOS row's display warehouse to Acumatica warehouse codes
                var OOS_TO_ACU = { "Brooklyn": ["TP-NY"], "Ohio": ["TP-OH"], "Hayward": ["TP-CA"], "Miami": ["TP-FL", "TP-MI"], "Kentucky": ["GGM-KY"], "Arizona": ["GGM-AZ"], "Hills CA": ["HILL-CP-CA"], "Hills NJ": ["HILL-CP-NJ"], "Hills FL": ["HILL-CP-FL"], "Hills TX": ["HILL-CP-TX"] };
                var allowed = OOS_TO_ACU[r._wh] || null;
                var allMatches = orderMap[String(r.MANUFACTURER_NO)] || [];
                var matches = allowed ? allMatches.filter(function(m) { return allowed.indexOf((m.wh || "").trim().toUpperCase()) >= 0; }) : allMatches;
                if (matches.length === 0) return <span style={{ color: "#D1D5DB", fontSize: 13 }}>{"\u2014"}</span>;
                function fmtDate(s) {
                  if (!s) return "";
                  var iso = String(s).split("T")[0];
                  var parts = iso.split("-");
                  if (parts.length === 3) return parseInt(parts[1]) + "/" + parseInt(parts[2]) + "/" + parts[0].slice(2);
                  return s;
                }
                var pendingCount = matches.filter(function(m) { return !m.received; }).length;
                var allPending = pendingCount === matches.length;
                var allReceived = pendingCount === 0;
                var pillContent, pillBg, pillFg, dotBg;
                if (allReceived) { pillContent = "Received"; pillBg = "#EFF6FF"; pillFg = "#2563EB"; dotBg = "#3B82F6"; }
                else if (allPending) { pillContent = matches.length > 1 ? "On Order \u00B7 " + matches.length + " POs" : "On Order"; pillBg = "#ECFDF5"; pillFg = "#059669"; dotBg = "#10B981"; }
                else { pillContent = "On Order \u00B7 " + pendingCount + " of " + matches.length; pillBg = "#ECFDF5"; pillFg = "#059669"; dotBg = "#10B981"; }
                return <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: pillFg, background: pillBg, padding: "3px 8px", borderRadius: 999, width: "fit-content" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotBg }} />
                    {pillContent}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {matches.map(function(m, mi) {
                      var ordStr = m.orderDate ? fmtDate(m.orderDate) : "";
                      var etaStr = m.expectedArrival ? fmtDate(m.expectedArrival) : "";
                      return <div key={mi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: m.received ? "#9CA3AF" : "#1F2937", textDecoration: m.received ? "line-through" : "none" }}>{m.po || "\u2014"}</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {ordStr && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: m.received ? "#9CA3AF" : "#4B5563", background: m.received ? "#F9FAFB" : "#F3F4F6", padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
                            <span style={{ fontWeight: 600, opacity: 0.7 }}>Order Date</span>
                            <span style={{ fontWeight: 500 }}>{ordStr}</span>
                          </span>}
                          {etaStr && <span title={m.etaSource ? "ETA source: " + m.etaSource : ""} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: m.received ? "#9CA3AF" : "#9A3412", background: m.received ? "#F9FAFB" : "#FFEDD5", padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", cursor: m.etaSource ? "help" : "default" }}>
                            <span style={{ fontWeight: 700, opacity: 0.85 }}>ETA</span>
                            <span style={{ fontWeight: 600 }}>{etaStr}</span>
                          </span>}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>;
              })()}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {currentName && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8 }}>Source: {currentName}</div>}
    </div>;
  }

  return <div>
    <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      <button onClick={function() { setTab("fuzerx"); setWhFilter("all"); setSearch(""); }} style={S.pill(tab === "fuzerx", "#3B82F6")}>FuzeRx{fuzeData.length > 0 && <span style={{ fontSize: 10, background: tab === "fuzerx" ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>{fuzeData.length}</span>}</button>
      <button onClick={function() { setTab("gogomeds"); setWhFilter("all"); setSearch(""); }} style={S.pill(tab === "gogomeds", "#8B5CF6")}>GoGoMeds{ggmData.length > 0 && <span style={{ fontSize: 10, background: tab === "gogomeds" ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>{ggmData.length}</span>}</button>
      <button onClick={function() { setTab("cgp"); setWhFilter("all"); setSearch(""); }} style={S.pill(tab === "cgp", "#10B981")}>Central Garden &amp; Pet{cgpData.length > 0 && <span style={{ fontSize: 10, background: tab === "cgp" ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>{cgpData.length}</span>}</button>
    </div>
    {data.length === 0 ? uploadZone(tab) : dataTable()}
  </div>;
}

/* ═══════ BACKORDER RESOLVER ═══════ */
function BackorderResolver(props) {
  var toast = props.toast, cred = props.cred;
  var TOOL_COLOR = "#14B8A6";
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _err = useState(null), err = _err[0], setErr = _err[1];
  var _resolved = useState([]), resolved = _resolved[0], setResolved = _resolved[1];
  var _backTotal = useState(0), backTotal = _backTotal[0], setBackTotal = _backTotal[1];
  var _notes = useState({}), notes = _notes[0], setNotes = _notes[1];
  var _statusMap = useState({}), statusMap = _statusMap[0], setStatusMap = _statusMap[1];
  var _search = useState(""), search = _search[0], setSearch = _search[1];
  var _vf = useState("all"), vendorFilter = _vf[0], setVendorFilter = _vf[1];
  var _sf = useState("all"), statusFilter = _sf[0], setStatusFilter = _sf[1];
  var _sort = useState(null), sortState = _sort[0], setSortState = _sort[1];
  var _lastFetched = useState(null), lastFetched = _lastFetched[0], setLastFetched = _lastFetched[1];
  var _cacheHit = useState(false), cacheHit = _cacheHit[0], setCacheHit = _cacheHit[1];
  var KV_NOTES = "backorder-resolver-notes";
  var KV_STATUS = "backorder-resolver-status";

  function fetchAll(forceFresh) {
    if (!cred || !cred.username || !cred.password) { setErr("Login required to fetch from Acumatica"); return; }
    setLoading(true); setErr(null);
    var refreshParam = forceFresh ? "?refresh=1" : "";
    Promise.all([
      fetch("/api/acumatica" + refreshParam, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "backorder", username: cred.username, password: cred.password }) }).then(function(r) { return r.json(); }),
      fetch("/api/acumatica" + refreshParam, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "open-po-lines", username: cred.username, password: cred.password }) }).then(function(r) { return r.json(); }),
    ]).then(function(both) {
      var bo = both[0].data || []; var pos = both[1].data || [];
      // Cache freshness based on the older of the two responses
      var ts0 = both[0]._cachedAt || Date.now();
      var ts1 = both[1]._cachedAt || Date.now();
      var bothHit = both[0]._cache === "hit" && both[1]._cache === "hit";
      setLastFetched(Math.min(ts0, ts1));
      setCacheHit(bothHit);
      var openIds = {};
      pos.forEach(function(p) { var id = (p.InventoryID || "").trim(); var open = (parseFloat(p.OrderQty) || 0) - (parseFloat(p.QtyOnReceipts) || 0); if (id && open > 0) openIds[id] = true; });
      var filtered = bo.filter(function(r) {
        var id = (r.InventoryID || "").trim();
        var vendor = (r.VendorName || "").trim();
        var mc = (r.MovementClass || "").trim();
        return id && !openIds[id] && vendor !== "Bloodworth Wholesale Drugs" && mc !== "Long-Term Backorder";
      });
      setBackTotal(bo.length);
      setResolved(filtered);
      setLoading(false);
      toast("Found " + filtered.length + " resolved backorders of " + bo.length + " total");
    }).catch(function(e) { setErr(e.message || "Failed"); setLoading(false); });
  }

  useEffect(function() {
    var m = true;
    kvGet(KV_NOTES).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m || !d || !d.data) return;
      var parsed = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
      delete parsed._savedAt; setNotes(parsed || {});
    }).catch(function() {});
    kvGet(KV_STATUS).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
      if (!m || !d || !d.data) return;
      var parsed = typeof d.data === "string" ? JSON.parse(d.data) : d.data;
      delete parsed._savedAt; setStatusMap(parsed || {});
    }).catch(function() {});
    return function() { m = false; };
  }, []);

  useEffect(function() { if (cred && cred.username) fetchAll(); }, [cred]);

  function updateNote(id, v) { var u = Object.assign({}, notes); u[id] = v; setNotes(u); kvPost(KV_NOTES, Object.assign({}, u, { _savedAt: Date.now() })).catch(function() {}); }
  function updateStatus(id, s) { var u = Object.assign({}, statusMap); if (s === "new") delete u[id]; else u[id] = s; setStatusMap(u); kvPost(KV_STATUS, Object.assign({}, u, { _savedAt: Date.now() })).catch(function() {}); }

  var vendors = useMemo(function() { return Array.from(new Set(resolved.map(function(r) { return r.VendorName; }).filter(Boolean))).sort(); }, [resolved]);

  var filtered = useMemo(function() {
    var d = resolved.slice();
    if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return (r.InventoryID || "").toLowerCase().indexOf(s) >= 0 || (r.Description || "").toLowerCase().indexOf(s) >= 0 || (r.VendorName || "").toLowerCase().indexOf(s) >= 0 || (r.SKUNDC || "").toLowerCase().indexOf(s) >= 0; }); }
    if (vendorFilter !== "all") d = d.filter(function(r) { return r.VendorName === vendorFilter; });
    if (statusFilter !== "all") d = d.filter(function(r) { var st = statusMap[r.InventoryID] || "new"; return st === statusFilter; });
    if (sortState) {
      d.sort(function(a, b) {
        var av, bv;
        if (sortState.col === "id") { av = a.InventoryID || ""; bv = b.InventoryID || ""; return sortState.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv); }
        if (sortState.col === "desc") { av = a.Description || ""; bv = b.Description || ""; return sortState.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv); }
        if (sortState.col === "vendor") { av = a.VendorName || ""; bv = b.VendorName || ""; return sortState.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv); }
        if (sortState.col === "mc") { av = a.MovementClass || ""; bv = b.MovementClass || ""; return sortState.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv); }
        if (sortState.col === "qty") { av = parseFloat(a.QtyOnHand) || 0; bv = parseFloat(b.QtyOnHand) || 0; return sortState.dir === "desc" ? bv - av : av - bv; }
        return 0;
      });
    }
    return d;
  }, [resolved, search, vendorFilter, statusFilter, sortState, statusMap]);

  function sortHeader(col, label, opts) {
    opts = opts || {};
    var isSorted = sortState && sortState.col === col;
    return <th onClick={function() { setSortState(isSorted ? (sortState.dir === "desc" ? { col: col, dir: "asc" } : null) : { col: col, dir: "desc" }); }} style={Object.assign({}, S.th, { cursor: "pointer", userSelect: "none" }, opts)}>{label}{isSorted ? (sortState.dir === "desc" ? " \u25BE" : " \u25B4") : ""}</th>;
  }

  function statusBadge(st) {
    var map = { "review": { bg: "#FEF3C7", fg: "#A16207", label: "In Review" }, "ordered": { bg: "#DBEAFE", fg: "#1D4ED8", label: "Ordered" }, "ignored": { bg: "#F3F4F6", fg: "#6B7280", label: "Ignored" } };
    var m = map[st]; if (!m) return null;
    return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, fontWeight: 600, background: m.bg, color: m.fg }}>{m.label}</span>;
  }

  return <div>
    {/* Stat cards */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
      <div style={Object.assign({}, S.statCard, { background: "#FEF2F2" })}><div style={{ fontSize: 11, color: "#B5736B", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Backordered</div><div style={{ fontSize: 28, fontWeight: 500, color: "#DC2626", marginTop: 6 }}>{backTotal}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#F0FDFA" })}><div style={{ fontSize: 11, color: "#6B9CA0", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Resolved (No Open PO)</div><div style={{ fontSize: 28, fontWeight: 500, color: "#0D9488", marginTop: 6 }}>{resolved.length}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#FEF3C7" })}><div style={{ fontSize: 11, color: "#A1804A", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>In Review</div><div style={{ fontSize: 28, fontWeight: 500, color: "#A16207", marginTop: 6 }}>{resolved.filter(function(r) { return statusMap[r.InventoryID] === "review"; }).length}</div></div>
      <div style={Object.assign({}, S.statCard, { background: "#DBEAFE" })}><div style={{ fontSize: 11, color: "#6B85B5", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>Ordered</div><div style={{ fontSize: 28, fontWeight: 500, color: "#1D4ED8", marginTop: 6 }}>{resolved.filter(function(r) { return statusMap[r.InventoryID] === "ordered"; }).length}</div></div>
    </div>

    {/* Toolbar */}
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search by ID, NDC, description, vendor..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
      <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{vendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
      <select style={S.sel} value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }}>
        <option value="all">All Statuses</option>
        <option value="new">New</option>
        <option value="review">In Review</option>
        <option value="ordered">Ordered</option>
        <option value="ignored">Ignored</option>
      </select>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "#6B7280" }}>{filtered.length}/{resolved.length}</span>
      <CacheStatus lastFetchedAt={lastFetched} cacheHit={cacheHit} refreshing={loading} color={TOOL_COLOR} onRefresh={function() { fetchAll(true); }} />
    </div>

    {err && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{err}</div>}

    {/* Table */}
    {resolved.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 360px)" })}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
        <thead><tr>
          <th style={Object.assign({}, S.th, { minWidth: 110 })}>Status</th>
          {sortHeader("id", "Inventory ID")}
          {sortHeader("desc", "Description", { minWidth: 200 })}
          {sortHeader("vendor", "Vendor")}
          {sortHeader("mc", "Movement Class")}
          {sortHeader("qty", "Qty On Hand", { textAlign: "right" })}
          <th style={Object.assign({}, S.th, { minWidth: 200 })}>Notes</th>
        </tr></thead>
        <tbody>{filtered.map(function(r, i) {
          var id = r.InventoryID; var st = statusMap[id] || "new";
          return <tr key={id + ":" + i}>
            <td style={S.td}>
              <select value={st} onChange={function(e) { updateStatus(id, e.target.value); }} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#374151", outline: "none", fontFamily: "'Varela Round', sans-serif", width: "100%" }}>
                <option value="new">New</option>
                <option value="review">In Review</option>
                <option value="ordered">Ordered</option>
                <option value="ignored">Ignored</option>
              </select>
            </td>
            <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontWeight: 600, color: "#0D9488" })}>{id}</td>
            <td style={Object.assign({}, S.td, { color: "#374151" })}>{r.Description}</td>
            <td style={S.td}>{r.VendorName}</td>
            <td style={S.td}><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 500, background: "#F3F4F6", color: "#6B7280" }}>{r.MovementClass}</span></td>
            <td style={Object.assign({}, S.td, { textAlign: "right" })}>{r.QtyOnHand}</td>
            <td style={S.td}><input value={notes[id] !== undefined ? notes[id] : ""} onChange={function(e) { updateNote(id, e.target.value); }} placeholder="Add notes..." style={Object.assign({}, S.inp, { padding: "5px 10px", fontSize: 12, width: "100%" })} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}>{loading ? <Spinner color={TOOL_COLOR} size={20} /> : err ? err : "No resolved backorders found. Click Refresh to check."}</div>}
  </div>;
}

/* ═══════ VENDOR CONTACTS PAGE ═══════ */
function VendorSettingsPage(props) {
  var contacts = props.contacts, updateContacts = props.updateContacts, toast = props.toast;
  var channels = props.channels || {};
  var updateChannels = props.updateChannels;
  var shipRules = props.shipRules || {};
  var updateShipRules = props.updateShipRules;
  var S = useMemo(function() { return makeStyles("#6366F1"); }, []);
  var _editing = useState(null), editing = _editing[0], setEditing = _editing[1];
  var _newVendor = useState(""), newVendor = _newVendor[0], setNewVendor = _newVendor[1];
  var _newEmail = useState(""), newEmail = _newEmail[0], setNewEmail = _newEmail[1];
  var _editEmail = useState(""), editEmail = _editEmail[0], setEditEmail = _editEmail[1];
  var _editChannel = useState(""), editChannel = _editChannel[0], setEditChannel = _editChannel[1];
  var _editRule = useState(""), editRule = _editRule[0], setEditRule = _editRule[1];
  var _search = useState(""), search = _search[0], setSearch = _search[1];

  // Union of all vendor names across contacts, channels, and shipRules — so that
  // legacy vendors that exist only in shipRules (and not yet in contacts) still
  // show up on this combined page.
  var allVendors = useMemo(function() {
    var set = {};
    Object.keys(contacts || {}).forEach(function(v) { if (v) set[v] = true; });
    Object.keys(channels || {}).forEach(function(v) { if (v) set[v] = true; });
    Object.keys(shipRules || {}).forEach(function(v) { if (v) set[v] = true; });
    return Object.keys(set);
  }, [contacts, channels, shipRules]);

  var sorted = useMemo(function() {
    var rows = allVendors.map(function(v) {
      return { vendor: v, email: contacts[v] || "", channel: channels[v] || "", rule: shipRules[v] || "" };
    });
    if (search) {
      var s = search.toLowerCase();
      rows = rows.filter(function(r) {
        return r.vendor.toLowerCase().indexOf(s) >= 0
            || r.email.toLowerCase().indexOf(s) >= 0
            || r.channel.toLowerCase().indexOf(s) >= 0
            || r.rule.toLowerCase().indexOf(s) >= 0;
      });
    }
    return rows.sort(function(a, b) { return a.vendor.localeCompare(b.vendor); });
  }, [allVendors, contacts, channels, shipRules, search]);

  // Add a new vendor. Email and rule are both optional; vendor name is required.
  function addVendor() {
    var v = newVendor.trim(), e = newEmail.trim();
    if (!v) { toast("Enter vendor name", "error"); return; }
    var u = Object.assign({}, contacts);
    u[v] = e;
    updateContacts(u);
    // Seed an empty shipping rule entry if one doesn't exist
    if (updateShipRules && !shipRules.hasOwnProperty(v)) {
      var sr = Object.assign({}, shipRules);
      sr[v] = "";
      updateShipRules(sr);
    }
    setNewVendor(""); setNewEmail("");
    toast("Added " + v);
  }

  // Save the in-place edit. All four fields (email, channel, rule) come out together.
  function saveEdit(vendor) {
    var uc = Object.assign({}, contacts);
    uc[vendor] = editEmail.trim();
    updateContacts(uc);

    if (updateChannels) {
      var uch = Object.assign({}, channels);
      if (editChannel) { uch[vendor] = editChannel; } else { delete uch[vendor]; }
      updateChannels(uch);
    }

    if (updateShipRules) {
      var ur = Object.assign({}, shipRules);
      ur[vendor] = editRule.trim();
      updateShipRules(ur);
    }

    setEditing(null);
    toast("Updated " + vendor);
  }

  // Remove vendor everywhere
  function removeVendor(vendor) {
    var msg = "Remove " + vendor + "?\n\nThis will delete its email, channel, and shipping rule.";
    if (!confirm(msg)) return;
    var uc = Object.assign({}, contacts); delete uc[vendor]; updateContacts(uc);
    if (updateChannels) { var uch = Object.assign({}, channels); delete uch[vendor]; updateChannels(uch); }
    if (updateShipRules) { var ur = Object.assign({}, shipRules); delete ur[vendor]; updateShipRules(ur); }
    toast("Removed " + vendor);
  }

  return <div>
    <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" })}>
      <input value={newVendor} onChange={function(e) { setNewVendor(e.target.value); }} placeholder="Vendor name..." style={Object.assign({}, S.inp, { padding: "8px 14px", flex: 1, minWidth: 180 })} />
      <input value={newEmail} onChange={function(e) { setNewEmail(e.target.value); }} placeholder="email1@example.com, email2@example.com (optional)" style={Object.assign({}, S.inp, { padding: "8px 14px", flex: 2, minWidth: 280 })} />
      <button onClick={addVendor} style={S.btn()}>+ Add</button>
    </div>
    <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
      <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search vendors, emails, channels, or rules..." style={Object.assign({}, S.inp, { padding: "8px 14px", width: 360 })} />
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "#9CA3AF" }}>{sorted.length} vendors</span>
    </div>
    <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
        <thead><tr><th style={Object.assign({}, S.th, { width: "20%" })}>Vendor</th><th style={Object.assign({}, S.th, { width: "22%" })}>Email(s)</th><th style={S.th}>Shipping Rule</th><th style={Object.assign({}, S.th, { width: 170 })}>Channel</th><th style={Object.assign({}, S.th, { width: 140 })}>Actions</th></tr></thead>
        <tbody>{sorted.map(function(row) {
          var vendor = row.vendor, email = row.email, ch = row.channel, rule = row.rule;
          var isEditing = editing === vendor;
          return <tr key={vendor}>
            <td style={Object.assign({}, S.td, { fontWeight: 500, color: "#374151" })}>{vendor}</td>

            <td style={S.td}>{isEditing ? <input value={editEmail} onChange={function(ev) { setEditEmail(ev.target.value); }} placeholder="email1@example.com (optional)" style={Object.assign({}, S.inp, { padding: "5px 10px", fontSize: 13, width: "100%" })} autoFocus onKeyDown={function(ev) { if (ev.key === "Enter") { saveEdit(vendor); } if (ev.key === "Escape") setEditing(null); }} /> : (email ? <span style={{ color: "#6B7280" }}>{email}</span> : <span style={{ color: "#9CA3AF", fontStyle: "italic", fontSize: 12 }}>no email set</span>)}</td>

            <td style={S.td}>{isEditing ? <input value={editRule} onChange={function(ev) { setEditRule(ev.target.value); }} placeholder="e.g. min:5000; message:Free Shipping; else:Not Free Shipping" style={Object.assign({}, S.inp, { padding: "5px 10px", fontSize: 13, width: "100%" })} onKeyDown={function(ev) { if (ev.key === "Enter") { saveEdit(vendor); } if (ev.key === "Escape") setEditing(null); }} /> : (rule ? <span style={{ color: "#6B7280" }}>{rule}</span> : <span style={{ color: "#9CA3AF", fontStyle: "italic", fontSize: 12 }}>no rule set</span>)}</td>

            <td style={S.td}>{isEditing ? (
              <select value={editChannel} onChange={function(ev) { setEditChannel(ev.target.value); }} style={Object.assign({}, S.sel, { padding: "5px 8px", fontSize: 12, width: "100%" })}>
                <option value="">— select —</option>
                <option value="Email">Email</option>
                <option value="TrueCommerce EDI">TrueCommerce EDI</option>
                <option value="Website Ordering">Website Ordering</option>
              </select>
            ) : (
              ch ? <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 10, fontWeight: 600, background: ch === "Email" ? "#ECFDF5" : ch === "TrueCommerce EDI" ? "#EFF6FF" : "#FFF7ED", color: ch === "Email" ? "#059669" : ch === "TrueCommerce EDI" ? "#2563EB" : "#C2410C" }}>{ch}</span> : <span style={{ fontSize: 11, color: "#9CA3AF", fontStyle: "italic" }}>not set</span>
            )}</td>

            <td style={Object.assign({}, S.td, { textAlign: "center" })}>{isEditing ? <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
              <button onClick={function() { saveEdit(vendor); }} style={Object.assign({}, S.btn(), { padding: "4px 10px", fontSize: 11 })}>Save</button>
              <button onClick={function() { setEditing(null); }} style={Object.assign({}, S.btn("ghost"), { padding: "4px 10px", fontSize: 11 })}>Cancel</button>
              <button onClick={function() { removeVendor(vendor); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626", fontSize: 14, padding: 4, marginLeft: 4 }} title="Delete vendor">{"\u2715"}</button>
            </div> : <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
              <button onClick={function() { setEditing(vendor); setEditEmail(email); setEditChannel(ch); setEditRule(rule); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 14, padding: 4 }} title="Edit">{"\u270E"}</button>
            </div>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8 }}>Shared with team &middot; Channel controls PO Tools behavior (Email = Acumatica email; TrueCommerce EDI / Website Ordering = write Vendor Ref only, keep On Hold). Shipping Rule controls free-shipping logic on PO Tools.</div>
  </div>;
}


/* ═══════ MAIN HUB ═══════ */
export default function Hub() {
  var _p = useState(function() {
    if (typeof window !== "undefined") {
      var qp = new URLSearchParams(window.location.search).get("page");
      if (qp) return qp;
    }
    var s = sGet("active-page"); return s || "TP-NY";
  }), page = _p[0], setPage = _p[1];
  function setPagePersist(p) { setPage(p); sSet("active-page", p); }
  var _c = useState({ username: "", password: "" }), cred = _c[0], setCred = _c[1];
  var _ok = useState(false), ok = _ok[0], setOk = _ok[1];
  var _sl = useState(false), showLogin = _sl[0], setShowLogin = _sl[1];
  var _t = useState(null), toast = _t[0], setToast = _t[1];
  var _cl = useState(true), credLoading = _cl[0], setCredLoading = _cl[1];
  var _gm = useState(null), gmail = _gm[0], setGmail = _gm[1];
  var _sr = useState(function() { var saved = sGet("shipping-rules-v2"); return saved || Object.assign({}, DEFAULT_SHIP_RULES); }), shipRules = _sr[0], setShipRules = _sr[1];
  var _vc = useState(Object.assign({}, CONTACTS)), vendorContacts = _vc[0], setVendorContacts = _vc[1];
  var _vch = useState({}), vendorChannels = _vch[0], setVendorChannels = _vch[1];
  var _sideCol = useState(function() { return sGet("sidebar-collapsed") || {}; }), sideCollapsed = _sideCol[0], setSideCollapsed = _sideCol[1];
  var _sideHide = useState(false), sidebarHidden = _sideHide[0], setSidebarHidden = _sideHide[1];
  function toggleSection(key) { var u = Object.assign({}, sideCollapsed); u[key] = !u[key]; setSideCollapsed(u); sSet("sidebar-collapsed", u); }
  function updateShipRules(newRules) { setShipRules(newRules); sSet("shipping-rules-v2", newRules); kvPost("shipping-rules-v2", newRules).catch(function() {}); }
  function updateVendorContacts(newContacts) { setVendorContacts(newContacts); kvPost("vendor-contacts", newContacts).catch(function() {}); }
  function updateVendorChannels(newChannels) { setVendorChannels(newChannels); kvPost("vendor-channels", newChannels).catch(function() {}); }

  var showToast = useCallback(function(m, t) { setToast({ m: m, t: t || "success" }); setTimeout(function() { setToast(null); }, 3500); }, []);
  useEffect(function() { var mt = true; (async function() { var s = sGet("user-credentials"); if (mt && s && s.username && s.password) { setCred(s); setOk(true); } var g = getGmailToken(); if (mt && g && g.token) { setGmail(g); } if (mt) setCredLoading(false); kvGet("vendor-contacts").then(function(r) { return r.ok ? r.json() : null; }).then(function(d) { if (mt && d && d.data && typeof d.data === "object" && Object.keys(d.data).length > 0) { setVendorContacts(d.data); } }).catch(function() {}); kvGet("vendor-channels").then(function(r) { return r.ok ? r.json() : null; }).then(function(d) { if (mt && d && d.data && typeof d.data === "object" && Object.keys(d.data).length > 0) { setVendorChannels(d.data); } }).catch(function() {}); kvGet("shipping-rules-v2").then(function(r) { return r.ok ? r.json() : null; }).then(function(d) { if (mt && d && d.data && typeof d.data === "object" && Object.keys(d.data).length > 0) { setShipRules(d.data); } }).catch(function() {}); })(); return function() { mt = false; }; }, []);

  // Handle Gmail OAuth callback (reads token from URL hash)
  useEffect(function() {
    var hash = window.location.hash;
    if (hash && hash.indexOf("gmail_token=") >= 0) {
      var params = new URLSearchParams(hash.substring(1));
      var token = params.get("gmail_token");
      var email = params.get("gmail_email") || "";
      if (token) {
        setGmailToken(token, email);
        setGmail({ token: token, email: email });
        showToast("Gmail connected: " + email);
      }
      // Clean up the URL hash
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [showToast]);

  var connectGmail = useCallback(function() {
    var origin = window.location.origin;
    window.location.href = "/api/gmail-auth?origin=" + encodeURIComponent(origin);
  }, []);
  var disconnectGmail = useCallback(function() {
    clearGmailToken();
    setGmail(null);
    showToast("Gmail disconnected", "info");
  }, [showToast]);
  var _loginLoading = useState(false), loginLoading = _loginLoading[0], setLoginLoading = _loginLoading[1];
  var login = useCallback(async function() {
    if (!cred.username || !cred.password) { showToast("Enter both username and password", "error"); return; }
    setLoginLoading(true);
    try {
      var resp = await fetch("/api/acumatica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ndc-lookup", username: cred.username, password: cred.password }),
      });
      var json = await resp.json();
      if (!resp.ok || json.error) {
        showToast("Login failed: " + (json.error || "Invalid credentials"), "error");
        return;
      }
      sSet("user-credentials", cred); setOk(true); setShowLogin(false); showToast("Connected to Acumatica");
    } catch (err) {
      showToast("Login failed: " + err.message, "error");
    } finally { setLoginLoading(false); }
  }, [cred, showToast]);
  var logout = useCallback(async function() { sDel("user-credentials"); setCred({ username: "", password: "" }); setOk(false); showToast("Logged out", "info"); }, [showToast]);
  var promptLogin = useCallback(function() { setShowLogin(true); showToast("Please log in first", "info"); }, [showToast]);

  var sdColumns = useMemo(function() { return [
    { key: "ItemStatus", label: "Status", badgeFn: function(v) { return v.toLowerCase() === "active" ? "success" : "default"; } },
    { key: "Description", label: "Description", copyable: true },
    { key: "VendorName", label: "Vendor" },
    { key: "InventoryID", label: "Inv. ID", mono: true },
    { key: "SKUNDC", label: "SKU/NDC", mono: true },
    { key: "BestKnownDating", label: "Best Dating", highlightColor: "#D97706", bold: true },
    { key: "QtyOnHand", label: "Qty", align: "right" },
    { key: "BaseUnit", label: "Unit" },
    { key: "OpenQty", label: "Open", align: "right" },
    { key: "NoteText", label: "Notes" },
  ]; }, []);

  var sdEmail = useMemo(function() { return {
    title: "Generate Email Drafts", subtitle: "One draft per vendor \u2014 asking about better dating availability.", subjectPrefix: "Short-Dating Items \u2013 ",
    buildTo: function(e) { return ["hd-purchaseorders@vetcove.com", e].filter(Boolean).join(", "); },
    tableCols: [{ key: "#", label: "#" }, { key: "Description", label: "Product" }, { key: "InventoryID", label: "Inventory ID" }, { key: "SKUNDC", label: "TruePill SKU" }, { key: "BestKnownDating", label: "Best Known Dating", highlightColor: "#D97706" }],
  }; }, []);

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
    { key: "RecoveryDate", label: "Recovery Date", highlightColor: "#3B82F6", bold: true },
  ]; }, []);

  var bkoEmail = useMemo(function() { return {
    title: "Generate Backorder Emails", subtitle: "One draft per vendor \u2014 asking for recovery ETA updates. CC: hd-purchaseorders@vetcove.com", subjectPrefix: "Backorder Item Status \u2013 ",
    buildTo: function(e) { return e || ""; },
    tableCols: [{ key: "#", label: "#" }, { key: "Description", label: "Product Description" }, { key: "InventoryID", label: "Inventory ID (Mfr No.)" }, { key: "RecoveryDate", label: "Recovery Date", highlightColor: "#3B82F6" }],
  }; }, []);

  if (credLoading) return <div style={{ fontFamily: "sans-serif", background: "#F8F9FB", color: "#374151", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner color="#3B82F6" size={24} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  if (!ok) return (
    <div style={{ fontFamily: "'Varela Round',sans-serif", background: "#F8F9FB", color: "#374151", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Varela+Round&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.12)}input:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)}`}</style>
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 16, padding: 40, width: 420, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}><IconKey /></div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1F2937", margin: "0 0 4px" }}>Procurement Hub</h1>
        <p style={{ fontSize: 11, color: "#6B7280", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", margin: "0 0 32px" }}>Vetcove Tools</p>
        <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 6 }}>Acumatica Username</label><input style={{ background: "#F8F9FB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 14px", color: "#374151", fontSize: 14, outline: "none", width: "100%" }} value={cred.username} onChange={function(e) { setCred({ username: e.target.value, password: cred.password }); }} placeholder="your.username" /></div>
          <div><label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 6 }}>Acumatica Password</label><input style={{ background: "#F8F9FB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 14px", color: "#374151", fontSize: 14, outline: "none", width: "100%" }} type="password" value={cred.password} onChange={function(e) { setCred({ username: cred.username, password: e.target.value }); }} placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} onKeyDown={function(e) { if (e.key === "Enter") login(); }} /></div>
          <button onClick={login} disabled={loginLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "12px 16px", fontSize: 14, fontWeight: 600, cursor: loginLoading ? "wait" : "pointer", marginTop: 8, opacity: loginLoading ? 0.7 : 1 }}>{loginLoading ? <><Spinner color="#fff" size={14} /> Verifying...</> : <><IconKey /> Sign In</>}</button>
        </div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#FFFFFF", color: toast.t === "success" || toast.t === "error" ? "#fff" : "#1F2937", border: "1px solid " + (toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#E5E7EB"), boxShadow: "0 4px 20px rgba(44,40,37,0.12)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );

  var isWH = page in WH;
  var activeColor = isWH ? WH[page].color : page === "short-dating" ? "#E879F9" : page === "backorder" ? "#F97316" : page === "backorder-resolver" ? "#14B8A6" : page === "po-import" ? "#06B6D4" : page === "cycle-count" ? "#14B8A6" : page === "fuze-tracker" ? "#F59E0B" : page === "ggm-tracker" ? "#8B5CF6" : page === "hills-pawtree" ? "#10B981" : page === "truckloader" ? "#D97706" : page === "oos-tracker" ? "#EF4444" : page === "vendor-settings" ? "#6366F1" : page === "how-to" ? "#6B7280" : "#3B82F6";
  var activeLabel = isWH ? WH[page].full : page === "short-dating" ? "Short-Dating Tracker" : page === "backorder" ? "Backorder Tracker" : page === "backorder-resolver" ? "Backorder Resolver" : page === "po-import" ? "Generic PO Translator" : page === "cycle-count" ? "Cycle Counting" : page === "fuze-tracker" ? "Fuze Tracker" : page === "ggm-tracker" ? "GGM Tracker" : page === "hills-pawtree" ? "Hills & Pawtree Tracker" : page === "truckloader" ? "Truckloader" : page === "oos-tracker" ? "OOS Tracker" : page === "vendor-settings" ? "Vendor Settings" : page === "how-to" ? "How-To Guide" : showLogin ? "Login" : "Vendor Settings";

  function SideLink(p) {
    var active = page === p.id && !showLogin;
    return <div onClick={function() { setPagePersist(p.id); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", margin: "1px 12px", fontSize: 13, cursor: "pointer", transition: "all 0.15s", fontWeight: active ? 500 : 400, color: active ? "#93bbfc" : "rgba(255,255,255,0.55)", background: active ? "rgba(96,165,250,0.15)" : "transparent", borderRadius: 8 }}><Dot color={p.color} />{p.label}</div>;
  }

  return (
    <div style={{ fontFamily: "'Varela Round',sans-serif", background: "#F8F9FB", color: "#374151", minHeight: "100vh", display: "flex" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Varela+Round&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#F8F9FB}::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.08)}input:focus,select:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.12)}tr:hover td{background:rgba(59,130,246,0.02)}`}</style>

      <div style={{ width: sidebarHidden ? 0 : 230, background: "#1A1F2E", display: "flex", flexDirection: "column", padding: sidebarHidden ? 0 : "20px 0", flexShrink: 0, overflow: "hidden", transition: "width 0.2s ease", position: "relative" }}>
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.5px", color: "#FFFFFF", margin: 0 }}>Procurement Hub</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 4 }}>Vetcove Tools</p>
          </div>
          <button onClick={function() { setSidebarHidden(true); }} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 6, padding: "4px 6px", cursor: "pointer", color: "rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }} title="Collapse sidebar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg></button>
        </div>
        {(function() {
          var sections = [
            { key: "po", label: "PO Tools", items: Object.entries(WH).map(function(e) { return { id: e[0], label: e[1].full, color: e[1].color }; }) },
            { key: "generic", label: "Generic PO Tools", items: [{ id: "po-import", label: "Generic PO Translator", color: "#06B6D4" }, { id: "cycle-count", label: "Cycle Counting", color: "#14B8A6" }] },
            { key: "hills", label: "Hills Tools", items: [{ id: "hills-pawtree", label: "Hills & Pawtree", color: "#10B981" }, { id: "truckloader", label: "Truckloader", color: "#D97706" }] },
            { key: "oos", label: "OOS", items: [{ id: "oos-tracker", label: "OOS Tracker", color: "#EF4444" }] },
            { key: "tracking", label: "Tracking", items: [{ id: "fuze-tracker", label: "Fuze Tracker", color: "#F59E0B" }, { id: "ggm-tracker", label: "GGM Tracker", color: "#8B5CF6" }] },
            { key: "inventory", label: "Inventory Tools", items: [{ id: "short-dating", label: "Short-Dating", color: "#E879F9" }, { id: "backorder", label: "Backorders", color: "#F97316" }, { id: "backorder-resolver", label: "Backorder Resolver", color: "#14B8A6" }] },
          ];
          return sections.map(function(sec, si) {
            var hasActive = sec.items.some(function(item) { return page === item.id && !showLogin; });
            var isCollapsed = sideCollapsed[sec.key] && !hasActive;
            return <div key={sec.key} style={{ borderTop: si > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", paddingTop: si > 0 ? 8 : 0 }}>
              <div onClick={function() { toggleSection(sec.key); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px", cursor: "pointer", userSelect: "none" }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "1px" }}>{sec.label}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform 0.2s", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              {!isCollapsed && <div style={{ paddingBottom: 4 }}>{sec.items.map(function(item) { return <SideLink key={item.id} id={item.id} label={item.label} color={item.color} />; })}</div>}
            </div>;
          });
        })()}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
          <div style={{ padding: "8px 20px" }}><span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "1px" }}>Settings</span></div>
          <div onClick={function() { setPagePersist("vendor-settings"); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", margin: "1px 12px", fontSize: 13, cursor: "pointer", fontWeight: page === "vendor-settings" && !showLogin ? 500 : 400, color: page === "vendor-settings" && !showLogin ? "#93bbfc" : "rgba(255,255,255,0.55)", background: page === "vendor-settings" && !showLogin ? "rgba(96,165,250,0.15)" : "transparent", borderRadius: 8 }}><IconMail /> Vendor Settings</div>
          <div onClick={function() { setPagePersist("how-to"); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", margin: "1px 12px", fontSize: 13, cursor: "pointer", fontWeight: page === "how-to" && !showLogin ? 500 : 400, color: page === "how-to" && !showLogin ? "#93bbfc" : "rgba(255,255,255,0.55)", background: page === "how-to" && !showLogin ? "rgba(96,165,250,0.15)" : "transparent", borderRadius: 8 }}><IconCSV /> How-To Guide</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: "0 12px" }}>
          <div style={{ padding: "12px 14px", background: ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", borderRadius: 10, border: "1px solid " + (ok ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)") }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Dot color={ok ? "#34D399" : "#F87171"} /><span style={{ fontSize: 12, color: ok ? "#34D399" : "#F87171", fontWeight: 500 }}>{ok ? "Connected" : "Not Connected"}</span></div>
            {ok && cred.username && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, paddingLeft: 16 }}>{cred.username}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={function() { setShowLogin(true); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer" }}><IconKey /> {ok ? "Update" : "Login"}</button>
              {ok && <button onClick={logout} style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>Logout</button>}
            </div>
          </div>
          <div style={{ padding: "12px 14px", marginTop: 8, background: gmail ? "rgba(59,130,246,0.1)" : "rgba(100,116,139,0.08)", borderRadius: 10, border: "1px solid " + (gmail ? "rgba(59,130,246,0.15)" : "rgba(100,116,139,0.1)") }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><IconGmail /><span style={{ fontSize: 12, color: gmail ? "#60A5FA" : "rgba(255,255,255,0.4)", fontWeight: 500 }}>{gmail ? "Gmail Connected" : "Gmail Not Connected"}</span></div>
            {gmail && gmail.email && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, paddingLeft: 22 }}>{gmail.email}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={connectGmail} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer" }}><IconGmail /> {gmail ? "Reconnect" : "Connect"}</button>
              {gmail && <button onClick={disconnectGmail} style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>Disconnect</button>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        <div style={{ padding: "16px 32px", borderBottom: "0.5px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {sidebarHidden && <button onClick={function() { setSidebarHidden(false); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: "#6B7280", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 4 }} title="Show sidebar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg></button>}
            {!showLogin && <Dot color={activeColor} />}<span style={{ fontSize: 18, fontWeight: 500, color: "#1F2937" }}>{showLogin ? "Acumatica Login" : activeLabel}</span>{isWH && !showLogin && <span style={{ fontSize: 11, background: activeColor + "15", color: activeColor, padding: "3px 10px", borderRadius: 6, fontWeight: 500 }}>{page}</span>}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{!ok && !showLogin && <span style={{ fontSize: 12, color: "#DC2626", display: "flex", alignItems: "center", gap: 4 }}><IconLock /> View only</span>}<span style={{ fontSize: 12, color: "#6B7280" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></div>
        </div>
        <div style={{ padding: 32, flex: 1 }}>
          {showLogin && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}><div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 32, width: 400, textAlign: "center" }}><div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><IconKey /></div><h2 style={{ fontSize: 20, fontWeight: 700, color: "#1F2937", margin: "0 0 4px" }}>Acumatica Login</h2><p style={{ color: "#9CA3AF", fontSize: 11, margin: "0 0 24px" }}>Shared across all tools</p><div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}><div><label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 4 }}>Username</label><input style={{ background: "#F8F9FB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", color: "#374151", fontSize: 13, outline: "none", width: "100%" }} value={cred.username} onChange={function(e) { setCred({ username: e.target.value, password: cred.password }); }} placeholder="your.username" /></div><div><label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 4 }}>Password</label><input style={{ background: "#F8F9FB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", color: "#374151", fontSize: 13, outline: "none", width: "100%" }} type="password" value={cred.password} onChange={function(e) { setCred({ username: cred.username, password: e.target.value }); }} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" /></div><button onClick={login} disabled={loginLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: loginLoading ? "wait" : "pointer", marginTop: 8, opacity: loginLoading ? 0.7 : 1 }}>{loginLoading ? <><Spinner color="#fff" size={14} /> Verifying...</> : "Connect"}</button></div></div></div>}

          {!showLogin && Object.entries(WH).map(function(e) { return <div key={e[0]} style={{ display: page === e[0] ? "block" : "none" }}><WHT whKey={e[0]} cfg={e[1]} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} shipRules={shipRules} vendorChannels={vendorChannels} updateVendorChannels={updateVendorChannels} vendorContacts={vendorContacts} /></div>; })}
          {!showLogin && page === "short-dating" && <TrackerTool toolKey="short-dating" toolLabel="Short-Dating Tracker" toolColor="#E879F9" demoData={SD_DEMO} columns={sdColumns} emailConfig={sdEmail} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} contacts={vendorContacts} />}
          {!showLogin && page === "backorder" && <TrackerTool toolKey="backorder" toolLabel="Backorder Tracker" toolColor="#F97316" demoData={BKO_DEMO} columns={bkoColumns} emailConfig={bkoEmail} skipVendors={BKO_SKIP} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} contacts={vendorContacts} />}
          {!showLogin && page === "po-import" && <POImportTool toast={showToast} cred={cred} ok={ok} lp={promptLogin} />}
          {!showLogin && page === "cycle-count" && <CycleCountTool key="cc-standard" toast={showToast} cred={cred} />}
          {!showLogin && page === "fuze-tracker" && <FuzeTracker toast={showToast} cred={cred} />}
          {!showLogin && page === "ggm-tracker" && <GGMTracker toast={showToast} cred={cred} />}
          {!showLogin && page === "hills-pawtree" && <HillsTracker toast={showToast} ok={ok} lp={promptLogin} cred={cred} />}
          {!showLogin && page === "truckloader" && <TruckloaderTool toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} />}
          {!showLogin && page === "oos-tracker" && <OOSTracker toast={showToast} cred={cred} />}
          {!showLogin && page === "backorder-resolver" && <BackorderResolver toast={showToast} cred={cred} />}
          {!showLogin && (page === "vendor-settings" || page === "vendor-contacts" || page === "rules") && <VendorSettingsPage contacts={vendorContacts} updateContacts={updateVendorContacts} channels={vendorChannels} updateChannels={updateVendorChannels} shipRules={shipRules} updateShipRules={updateShipRules} toast={showToast} />}
          {!showLogin && page === "how-to" && <HowToGuide toast={showToast} />}
        </div>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#FFFFFF", color: toast.t === "success" || toast.t === "error" ? "#fff" : "#1F2937", border: "1px solid " + (toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#E5E7EB"), boxShadow: "0 4px 20px rgba(44,40,37,0.12)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );
}
