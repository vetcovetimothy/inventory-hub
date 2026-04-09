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

  useEffect(function() {
    var mounted = true;
    (async function() {
      var saved = sGet(storageKey);
      if (mounted && saved && saved.data && saved.data.length > 0) {
        setData(saved.data); setRunBy(saved.runBy || null); setRunTime(saved.runTime || null); setDrafts(saved.drafts || 0);
      }
      if (mounted) setInitLoading(false);
    })();
    return function() { mounted = false; };
  }, [storageKey]);

  var persist = useCallback(async function(d, by, time, dr) {
    sSet(storageKey, { data: d, runBy: by, runTime: time, drafts: dr });
  }, [storageKey]);

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
    toast(toolLabel + ": Cleared");
  }, [toast, storageKey, toolLabel]);

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
        var vendorEmail = CONTACTS[vendor] || "";
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
  }, [ok, lp, gmail, emailVendors, emailConfig, toast, data, runBy, runTime, persist, toolLabel]);

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
            var email = CONTACTS[vendor] || "";
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
            <tbody>{Object.entries(CONTACTS).filter(function(e) { return e[1]; }).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) { return <tr key={e[0]}><td style={Object.assign({}, S.td, { fontWeight: 500, color: "#374151" })}>{e[0]}</td><td style={Object.assign({}, S.td, { fontSize: 14, color: "#6B7280" })}>{e[1]}</td></tr>; })}</tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

/* ═══════ PO WAREHOUSE TOOL ═══════ */
function WHT(props) {
  var whKey = props.whKey, cfg = props.cfg, toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred, gmail = props.gmail, SHIP_RULES = props.shipRules || {};
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
  var _pcr = useState({}), pcReported = _pcr[0], setPcReported = _pcr[1];
  var _esel = useState(null), emailSelected = _esel[0], setEmailSelected = _esel[1];
  var _il = useState(true), initLoading = _il[0], setInitLoading = _il[1];
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
        setData(rows); setRunBy(who); setRunTime(now); setLoading(false); setSubPage("data"); setShipNotes(carried); persist(rows, false, who, now, carried); toast(cfg.label + ": Fetched " + rows.length + " lines");
      } catch (err) {
        setLoading(false);
        toast("Error: " + err.message, "error");
      }
    })();
  }, [whKey, cred, cfg.label, toast, ok, lp, persist]);
  var clearAll = useCallback(async function() { if (!ok) { lp(); return; } setData([]); setSearch(""); setVendorFilter("all"); setFlagsOnly(false); setEmailSent(false); setConfirmClear(false); setRunBy(null); setRunTime(null); setSubPage("overview"); setShipNotes({}); sDel("wh-data-" + whKey); sDel("ship-notes-" + whKey); try { await kvPost(kvKey, {}); } catch (e) {} toast(cfg.label + ": Cleared"); }, [cfg.label, toast, ok, lp, kvKey, whKey]);

  var vendorGroups = useMemo(function() { var g = {}; data.forEach(function(r) { var key = r.VendorName + " || " + (r.OrderNbr || ""); if (!g[key]) g[key] = []; g[key].push(r); }); return g; }, [data]);
  var vendorTotals = useMemo(function() { var t = {}; Object.entries(vendorGroups).forEach(function(e) { t[e[0]] = e[1].reduce(function(s, r) { return s + r.TotalPrice; }, 0); }); return t; }, [vendorGroups]);
  var uniqueVendors = useMemo(function() { return Array.from(new Set(data.map(function(r) { return r.VendorName; }))).sort(); }, [data]);
  var totalVal = useMemo(function() { return data.reduce(function(s, r) { return s + r.TotalPrice; }, 0); }, [data]);
  var flags = useMemo(function() { var f = { s: [], so: [] }; data.forEach(function(r, i) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") f.s.push(i); if (mc === "sell-off item") f.so.push(i); }); return f; }, [data]);
  var flagCount = flags.s.length + flags.so.length;
  var emailBlocked = !isGGM && (flags.s.length > 0 || flags.so.length > 0);
  var getFlag = function(r) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") return "short"; if (mc === "sell-off item") return "selloff"; return null; };
  var filtered = useMemo(function() { var d = data.slice(); if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return r.SKUNDC.toLowerCase().indexOf(s) >= 0 || r.Description.toLowerCase().indexOf(s) >= 0 || r.VendorName.toLowerCase().indexOf(s) >= 0; }); } if (vendorFilter !== "all") d = d.filter(function(r) { return r.VendorName === vendorFilter; }); if (flagsOnly) { var fi = new Set(flags.s.concat(flags.so)); d = d.filter(function(r) { return fi.has(data.indexOf(r)); }); } d.sort(function(a, b) { var fa = getFlag(a) ? 0 : 1; var fb = getFlag(b) ? 0 : 1; return fa - fb; }); return d; }, [data, search, vendorFilter, flagsOnly, flags]);
  var todayStr = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

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
      {flagCount > 0 && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconAlert /><span style={{ fontSize: 13, color: "#DC2626" }}><strong>Flagged:</strong>{flags.s.length > 0 && " " + flags.s.length + " Short-Dating"}{flags.so.length > 0 && " " + flags.so.length + " Sell-Off"}</span></div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
        <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
        <button style={S.btn(flagsOnly ? "danger" : "ghost")} onClick={function() { setFlagsOnly(!flagsOnly); }}><IconFilter /> {flagsOnly ? "Flags" : "Filter Flags"}</button>
        <div style={{ flex: 1 }} /><Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "8px 16px", fontSize: 12 })} onClick={fetchData} disabled={loading}>{loading ? <><Spinner /> Fetching...</> : <><IconRefresh /> Re-fetch</>}</Gate><span style={{ fontSize: 12, color: "#6B7280" }}>{filtered.length}/{data.length}</span>
      </div>
      {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 260px)" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr>{["SKU", "Description", "Qty", "Vendor", "PO #"].concat(!isGGM ? ["Reorder", "Max", "Lead", "Min", "Avail"] : []).concat(["Price", "Total", "Flag"]).map(function(h) { return <th key={h} style={S.th}>{h}</th>; })}</tr></thead>
          <tbody>{filtered.map(function(r, i) { var f = getFlag(r); var bg = f === "short" ? "rgba(220,38,38,0.04)" : f === "selloff" ? "rgba(217,119,6,0.04)" : "transparent"; var tc = f === "short" ? "#DC2626" : f === "selloff" ? "#D97706" : "#374151"; var fmt = function(v) { var n = parseFloat(v); if (isNaN(n)) return v; return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2); }; return <tr key={i} style={{ background: bg }}><td style={Object.assign({}, S.td, { color: tc, minWidth: 120, whiteSpace: "nowrap" })}>{r.SKUNDC}</td><td style={Object.assign({}, S.td, { color: tc, minWidth: 180, maxWidth: 350 })}><CopyCell text={r.Description} toast={toast} color={tc} accentColor={cfg.color} /></td><td style={Object.assign({}, S.td, { color: tc })}>{fmt(r.OrderQty)}</td><td style={Object.assign({}, S.td, { color: tc })}>{r.VendorName}</td><td style={Object.assign({}, S.td, { color: tc })}>{r.OrderNbr}</td>{!isGGM && <><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.ReorderPoint)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.MaxQty)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.LeadTime)}d</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.MinOrderQty)}</td><td style={Object.assign({}, S.td, { color: r.QtyAvailable < 0 ? "#DC2626" : tc, textAlign: "right" })}>{fmt(r.QtyAvailable)}</td></>}<td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>${r.Price.toFixed(2)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>${r.TotalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}>{f ? <span style={S.badge(f === "short" ? "danger" : "warning")}>{f === "short" ? "Short" : "Sell-Off"}</span> : "\u2014"}</td></tr>; })}</tbody>
        </table>
      </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#9CA3AF" })}>Run fetch first.</div>}
    </div>}

    {subPage === "shipping" && <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "8px 16px", fontSize: 12 })} onClick={fetchData} disabled={loading}>{loading ? <><Spinner /> Fetching...</> : <><IconRefresh /> Re-fetch</>}</Gate>
      </div>
      {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr><th style={S.th}>Vendor</th><th style={Object.assign({}, S.th, { width: 140 })}>PO #</th><th style={Object.assign({}, S.th, { textAlign: "right" })}>Total</th><th style={S.th}>Shipping</th><th style={Object.assign({}, S.th, { width: 200 })}>Vendor Reference</th><th style={Object.assign({}, S.th, { width: 100 })}>Price Check</th></tr></thead>
          <tbody>{Object.keys(vendorGroups).sort().map(function(key) { var parts = key.split(" || "), v = parts[0], po = parts[1] || ""; var t = vendorTotals[key], rl = SHIP_RULES[v] || "", st = rl ? evalShip(rl, t) : "No Rule", isFree = st === "Free Shipping"; var sn = shipNotes[key] || {}; var vl = getVendorLabel(v); var rows = vendorGroups[key] || []; var checkedCount = rows.filter(function(r) { return priceChecked[key + ":" + r.SKUNDC]; }).length; return <tr key={key}><td style={Object.assign({}, S.td, { color: "#1F2937" })}><div>{v}</div>{vl && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: vl === "Truecommerce" ? "#EFF6FF" : "#FFF7ED", color: vl === "Truecommerce" ? "#2563EB" : "#C2410C", fontWeight: 600, display: "inline-block", marginTop: 4 }}>{vl}</span>}</td><td style={Object.assign({}, S.td, { color: "#374151" })}>{po || <input style={Object.assign({}, S.inp, { padding: "6px 10px" })} placeholder="Paste PO #" value={sn.po || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[key] = Object.assign({}, sn, { po: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} />}</td><td style={Object.assign({}, S.td, { textAlign: "right" })}>${t.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}><span style={S.badge(isFree ? "success" : "danger")}>{isFree ? <IconCheck /> : <IconAlert />}{st}</span></td><td style={S.td}><input style={Object.assign({}, S.inp, { padding: "6px 10px" })} placeholder="Paste PO #..." value={sn.notes || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[key] = Object.assign({}, sn, { notes: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} /></td><td style={Object.assign({}, S.td, { textAlign: "center" })}><button onClick={function() { setPriceCheckKey(key); }} style={Object.assign({}, S.btn("ghost"), { padding: "4px 10px", fontSize: 11 })}>{checkedCount === rows.length && rows.length > 0 ? <><IconCheck /> All</> : checkedCount > 0 ? checkedCount + "/" + rows.length : "Review"}</button></td></tr>; })}</tbody>
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
    </div>}

    {/* Price Check Modal */}
    {priceCheckKey && (function() {
      var parts = priceCheckKey.split(" || ");
      var vendorName = parts[0], poNum = parts[1] || "";
      var rows = vendorGroups[priceCheckKey] || [];
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
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 32px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6", fontSize: 10, fontWeight: 500, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            <div style={{ width: 22 }}></div>
            <div style={{ minWidth: 110 }}>SKU</div>
            <div style={{ flex: 1 }}>Description</div>
            <div style={{ textAlign: "right", minWidth: 40 }}>Qty</div>
            <div style={{ textAlign: "right", minWidth: 75 }}>Unit Price</div>
            <div style={{ textAlign: "right", minWidth: 95 }}>Total</div>
            <div style={{ width: 1, height: 14, background: "#E5E7EB", margin: "0 4px" }}></div>
            <div style={{ textAlign: "right", minWidth: 90 }}>Reported</div>
            <div style={{ textAlign: "right", minWidth: 75 }}>Unit Cost</div>
          </div>
          {/* Item list */}
          <div style={{ overflow: "auto", flex: 1, padding: "4px 16px" }}>
            {rows.map(function(r, i) {
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
          <div style={{ display: "flex", gap: 8 }}><span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, width: 50 }}>To:</span><span style={{ fontSize: 13, color: "#374151" }}>{cfg.emailTo}</span></div>
          <div style={{ display: "flex", gap: 8 }}><span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, width: 50 }}>Subject:</span><span style={{ fontSize: 13, color: "#1F2937", fontWeight: 600 }}>{cfg.subjectFn(todayStr)}</span></div>
          <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 16, marginTop: 4, fontSize: 13, color: "#374151", lineHeight: 1.7 }}>Good morning,<br /><br />Attached are today&apos;s POs.<br /><br />Thanks in advance,<br /><br /><span style={{ color: "#9CA3AF", fontSize: 11, fontStyle: "italic" }}>Your Vetcove Gmail signature will be appended automatically</span></div>
        </div>
        <div style={{ marginTop: 20, borderTop: "1px solid #E5E7EB", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, textTransform: "uppercase" }}>Attachments ({(function() { var sel = emailSelected || {}; var count = uniqueVendors.filter(function(v) { return emailSelected === null || sel[v] !== false; }).length; return count; })()}/{uniqueVendors.length})</div>
            <button onClick={function() { var allSelected = emailSelected === null || uniqueVendors.every(function(v) { return emailSelected[v] !== false; }); var updated = {}; uniqueVendors.forEach(function(v) { updated[v] = allSelected ? false : true; }); setEmailSelected(allSelected ? updated : null); }} style={Object.assign({}, S.btn("ghost"), { padding: "4px 12px", fontSize: 11 })}>{emailSelected === null || uniqueVendors.every(function(v) { return emailSelected[v] !== false; }) ? "Deselect All" : "Select All"}</button>
          </div>
          {uniqueVendors.map(function(v) { var count = data.filter(function(r) { return r.VendorName === v; }).length; var isChecked = emailSelected === null || emailSelected[v] !== false; return <div key={v} onClick={function() { var updated = Object.assign({}, emailSelected || {}); if (emailSelected === null) { uniqueVendors.forEach(function(uv) { updated[uv] = true; }); } updated[v] = !isChecked; setEmailSelected(updated); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: isChecked ? "#F8F9FB" : "transparent", borderRadius: 8, marginBottom: 4, cursor: "pointer", border: isChecked ? "1px solid #E5E7EB" : "1px solid transparent", transition: "all 0.15s", opacity: isChecked ? 1 : 0.5 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, border: isChecked ? "2px solid " + cfg.color : "2px solid #D1D5DB", background: isChecked ? cfg.color : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
              {isChecked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            </div>
            <IconDL /><span style={{ fontSize: 12, color: isChecked ? "#4B5563" : "#9CA3AF" }}>{v} PO Data - {whKey}.xlsx</span><div style={{ flex: 1 }} /><span style={{ fontSize: 11, color: "#9CA3AF" }}>{count} rows</span>
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
              var toLine = cfg.emailTo;
              var subject = cfg.subjectFn(todayStr);
              var htmlBody = "<p>Good morning,</p><p>Attached are today's POs.</p><p>Thanks in advance,</p><br>";
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
  var _warehouse = useState(""), warehouse = _warehouse[0], setWarehouse = _warehouse[1];
  var _results = useState([]), results = _results[0], setResults = _results[1];
  var _errors = useState([]), errors = _errors[0], setErrors = _errors[1];
  var _loading = useState(false), loading = _loading[0], setLoading = _loading[1];

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
      var trimmed = json.rows.map(function(r) { return { "Inventory ID": r["Inventory ID"] || "", "Sales Unit": r["Sales Unit"] || "" }; }).filter(function(r) { return r["Inventory ID"]; });
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

    setLoading(true); setResults([]); setErrors([]);
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

      // Build Inventory ID → Sales Unit map from cached stock items
      var salesUnitMap = {};
      stockRows.forEach(function(r) {
        var invId = String(r["Inventory ID"] || "").trim();
        var salesUnit = String(r["Sales Unit"] || "").trim();
        if (invId) salesUnitMap[invId] = salesUnit;
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
        });
      });

      setResults(output);
      setErrors(errs);
      toast("Processed " + output.length + " items" + (errs.length > 0 ? ", " + errs.length + " warnings" : ""));
    } catch (err) {
      toast("Error: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function downloadCSV() {
    var header = "Inventory ID,Warehouse,Location,Quantity,UOM\r\n";
    var lines = results.map(function(r) {
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

          <div style={{ fontSize: 14, color: "#374151", fontWeight: 600, marginBottom: 8, marginTop: 20, display: "flex", alignItems: "center", gap: 6 }}>{isSftp ? "5" : "4"}. Stock Items XLSX <InfoTip text="Before uploading, make sure to delete all tabs except the one labeled 'Data' in the Excel file." /></div>
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
        {results.length > 0 && <button onClick={downloadCSV} style={Object.assign({}, S.btn("ghost"), { padding: "10px 16px" })}><IconDL /> Download CSV</button>}
        {results.length > 0 && <span style={{ fontSize: 12, color: "#6B7280" }}>{results.length} items</span>}
        {(ndcText.trim() || vendorFile || results.length > 0) && <button onClick={function() { setNdcText(""); setVendorFile(null); setVendorRows(null); setCsvWarehouses([]); setCsvWhSelected(""); setCsvWhCounts({}); setWarehouse(""); setResults([]); setErrors([]); setSftpFile(null); setSftpRows(null); }} style={Object.assign({}, S.btn("ghost"), { padding: "10px 16px", marginLeft: "auto" })}><IconTrash /> Clear</button>}
      </div>
    </div>

    {errors.length > 0 && <div style={{ marginBottom: 16 }}>
      {errors.map(function(err, i) {
        return <div key={i} style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 10, padding: "8px 14px", marginBottom: 6, fontSize: 13, color: "#D97706" }}>{"\u26A0"} {err}</div>;
      })}
    </div>}

    {results.length > 0 && <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 300px)" })}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
        <thead><tr>
          {["Inventory ID", "Warehouse", "Location", "Quantity", "UOM", "NDC", "Reported Qty", "Stock Qty"].map(function(h) { return <th key={h} style={S.th}>{h}</th>; })}
        </tr></thead>
        <tbody>{results.map(function(r, i) {
          return <tr key={i} style={{ background: r.quantity < 0 ? "rgba(220,38,38,0.04)" : "transparent" }}>
            <td style={Object.assign({}, S.td, { color: r.inventoryId.startsWith("GEN-") ? "#059669" : r.inventoryId.startsWith("UNV-") ? "#2563EB" : "#374151" })}>{r.inventoryId}</td>
            <td style={S.td}>{r.warehouse}</td>
            <td style={S.td}>{r.location}</td>
            <td style={Object.assign({}, S.td, { color: r.quantity < 0 ? "#DC2626" : "#374151" })}>{r.quantity.toFixed(1)}</td>
            <td style={S.td}>{r.uom}</td>
            <td style={Object.assign({}, S.td, { color: "#6B7280" })}>{r.ndc}</td>
            <td style={Object.assign({}, S.td, { color: "#6B7280" })}>{r.reportedQty.toFixed(1)}</td>
            <td style={Object.assign({}, S.td, { color: "#6B7280" })}>{r.stockQty.toFixed(1)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
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
  var _ndcMap = useState(null), ndcMap = _ndcMap[0], setNdcMap = _ndcMap[1];
  var _ndcLoading = useState(false), ndcLoading = _ndcLoading[0], setNdcLoading = _ndcLoading[1];
  var _activeFileTab = useState(null), activeFileTab = _activeFileTab[0], setActiveFileTab = _activeFileTab[1];
  // Persist results separately per vendor type so switching doesn't lose data
  var otherCache = useRef({ pdfs: [], results: [], editedPrices: {}, screenshotQtys: {}, error: null });
  var mckCache = useRef({ pdfs: [], results: [], mckPaste: "", mckParsed: null, mckFile: null, mckPortalPrices: {}, editedPrices: {}, screenshotQtys: {}, mckWarnings: [], error: null });

  function switchVendor(newVendor) {
    if (newVendor === vendor) return;
    // Save current state to cache
    if (vendor === "other") {
      otherCache.current = { pdfs: pdfs, results: results, editedPrices: editedPrices, screenshotQtys: screenshotQtys, error: error };
    } else {
      mckCache.current = { pdfs: pdfs, results: results, mckPaste: mckPaste, mckParsed: mckParsed, mckFile: mckFile, mckPortalPrices: mckPortalPrices, editedPrices: editedPrices, screenshotQtys: screenshotQtys, mckWarnings: mckWarnings, error: error };
    }
    // Restore from cache
    if (newVendor === "other") {
      var c = otherCache.current;
      setPdfs(c.pdfs); setResults(c.results); setEditedPrices(c.editedPrices); setScreenshotQtys(c.screenshotQtys); setError(c.error);
      setMckWarnings([]);
    } else {
      var m = mckCache.current;
      setPdfs(m.pdfs); setResults(m.results); setMckPaste(m.mckPaste); setMckParsed(m.mckParsed); setMckFile(m.mckFile); setMckPortalPrices(m.mckPortalPrices); setEditedPrices(m.editedPrices); setScreenshotQtys(m.screenshotQtys); setMckWarnings(m.mckWarnings); setError(m.error);
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
  var fetchNdcMap = useCallback(async function() {
    if (!cred || !cred.username || !cred.password) { toast("Please log in first", "error"); return null; }
    setNdcLoading(true);
    try {
      var resp = await fetch("/api/acumatica", {
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
      // Step 1: Parse PDFs via server
      var parseResp = await fetch("/api/po-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfs: pdfs }),
      });
      var parseJson = await parseResp.json();
      if (!parseResp.ok) throw new Error(parseJson.error || "Parse failed");
      if (parseJson.error) throw new Error(parseJson.error);
      var pdfItems = parseJson.items || [];
      if (pdfItems.length === 0) throw new Error("No items found. The PDF parser returned 0 NDCs. Check that your PDFs have the standard PO format.");

      // Step 2: Fetch NDC map from Acumatica
      var map = ndcMap;
      if (!map) {
        map = await fetchNdcMap();
        if (!map) throw new Error("Could not fetch NDC data from Acumatica. Check your login.");
      }

      // Step 3: Match each item's NDC against OData
      var matched = pdfItems.map(function(item) {
        var match = lookupNdc(item.ndc, map);
        return {
          ndc: item.ndc,
          drugName: item.drugName,
          qty: item.qty,
          totalPrice: item.totalPrice,
          unitPrice: item.unitPrice,
          warehouse: item.warehouse,
          vendorSource: item.vendorSource,
          vendorItemNum: item.vendorItemNum,
          poNumber: item.poNumber,
          sourceFile: item.sourceFile,
          inventoryId: match ? match.inventoryId : null,
          acumaticaDesc: match ? match.description : null,
          uom: match ? match.uom : null,
          ndcFound: !!match,
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
              r.unitPrice = mckPortalPrices[ndcNorm];
              r.totalPrice = r.qty ? +(r.qty * r.unitPrice).toFixed(2) : r.totalPrice;
            }
          });
        }
      }

      setResults(matched);
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
    setPdfs([]); setMckPaste(""); setMckParsed(null); setMckFile(null); setMckPortalPrices({}); setScreenshotQtys({}); setEditedPrices({}); setResults([]); setMckWarnings([]); setError(null); setActiveFileTab(null);
  }

  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);
  var fileList = useMemo(function() { if (vendor !== "other" || results.length === 0) return []; var f = {}; results.forEach(function(r) { if (r.sourceFile) f[r.sourceFile] = (f[r.sourceFile] || 0) + 1; }); return Object.keys(f).map(function(name) { return { name: name, count: f[name] }; }); }, [results, vendor]);
  var activeResults = useMemo(function() { if (vendor !== "other" || !activeFileTab || fileList.length <= 1) return results; return results.filter(function(r) { return r.sourceFile === activeFileTab; }); }, [results, vendor, activeFileTab, fileList]);
  var foundCount = activeResults.filter(function(r) { return r.ndcFound; }).length;
  var notFoundCount = activeResults.length - foundCount;
  var qtyMismatchCount = activeResults.filter(function(r) { return screenshotQtys[r.ndc] != null && parseInt(screenshotQtys[r.ndc]) !== r.qty; }).length;

  return (
    <div>
      <p style={{ color: "#6B7280", fontSize: 13, marginBottom: 20 }}>Upload vendor PO PDFs to extract NDCs, then validate against Acumatica <strong>Generic Current NDCs</strong> OData to find GEN- Inventory IDs.</p>

      <div style={S.card}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, marginBottom: 8 }}>Vendor Type</div>
          <div style={{ display: "flex", gap: 10 }}>
            {[["other", "Keysource / Anda / Bloodworth"], ["mckesson", "McKesson"]].map(function(v) {
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
          <button onClick={function() { setNdcMap(null); fetchNdcMap(); }} disabled={ndcLoading || !ok}
            style={Object.assign({}, S.btn("ghost"), { padding: "10px 16px", opacity: (!ok || ndcLoading) ? 0.5 : 1 })}>
            {ndcLoading ? <><Spinner /> Loading...</> : <><IconRefresh /> {ndcMap ? "Refresh NDC Map" : "Pre-load NDC Map"}</>}
          </button>
          {ndcMap && <span style={{ fontSize: 11, color: "#059669" }}>{"\u2713"} NDC map loaded</span>}
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
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Total Items</div><div style={{ fontSize: 24, fontWeight: 700, color: "#1F2937", marginTop: 4 }}>{activeResults.length}</div></div>
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>In OData</div><div style={{ fontSize: 24, fontWeight: 700, color: "#059669", marginTop: 4 }}>{foundCount}</div></div>
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Not in OData</div><div style={{ fontSize: 24, fontWeight: 700, color: notFoundCount > 0 ? "#DC2626" : "#059669", marginTop: 4 }}>{notFoundCount}</div></div>
          {vendor === "mckesson" && <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>Qty Edited</div><div style={{ fontSize: 24, fontWeight: 700, color: qtyMismatchCount > 0 ? "#D97706" : "#059669", marginTop: 4 }}>{qtyMismatchCount}</div></div>}
          {mckWarnings.length > 0 && <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: 600 }}>MCK Warnings</div><div style={{ fontSize: 24, fontWeight: 700, color: "#D97706", marginTop: 4 }}>{mckWarnings.length}</div></div>}
        </div>

        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #E5E7EB" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>NDC Validation Results</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={reset} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}><IconTrash /> Clear</button>
              {vendor === "other" && fileList.length > 1 && <button onClick={function() { downloadCSV(activeResults); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}><IconCSV /> Download Tab</button>}
              {vendor === "other" && fileList.length > 1 && <button onClick={function() { fileList.forEach(function(f, idx) { setTimeout(function() { downloadCSV(results.filter(function(r) { return r.sourceFile === f.name; })); }, idx * 300); }); }} style={Object.assign({}, S.btn(), { padding: "6px 14px", fontSize: 12 })}><IconCSV /> Download All ({fileList.length} files)</button>}
              {!(vendor === "other" && fileList.length > 1) && <button onClick={function() { downloadCSV(results); }} style={Object.assign({}, S.btn(), { padding: "6px 14px", fontSize: 12 })}><IconCSV /> Download CSV</button>}
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
              {vendor === "mckesson" && <th style={S.th}>MCK Item #</th>}
              <th style={S.th}>Source</th>
            </tr></thead>
            <tbody>{activeResults.map(function(r, i) {
              var editedQty = screenshotQtys[r.ndc] != null ? parseInt(screenshotQtys[r.ndc]) : r.qty;
              var qtyChanged = screenshotQtys[r.ndc] != null && parseInt(screenshotQtys[r.ndc]) !== r.qty;
              var editedPrice = editedPrices[r.ndc] != null ? parseFloat(editedPrices[r.ndc]) : r.unitPrice;
              var priceChanged = editedPrices[r.ndc] != null && parseFloat(editedPrices[r.ndc]) !== r.unitPrice;
              var extCost = (editedQty && editedPrice) ? (editedQty * editedPrice) : r.totalPrice;
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
                <td style={Object.assign({}, S.td, { textAlign: "right" })}>{extCost ? "$" + extCost.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "\u2014"}</td>
                {vendor === "mckesson" && <td style={S.td}>{r.vendorItemNum || "\u2014"}</td>}
                <td style={Object.assign({}, S.td, { color: "#9CA3AF" })}>{(r.sourceFile || "").split("/").pop()}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>}
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
    return data.slice().sort(function(a, b) {
      var wa = simplifyWarehouse(a.Warehouse, a.Vendor);
      var wb = simplifyWarehouse(b.Warehouse, b.Vendor);
      var order = { "NJ": 0, "CA": 1, "CA - Pawtree": 2 };
      var oa = order[wa] != null ? order[wa] : 3;
      var ob = order[wb] != null ? order[wb] : 3;
      if (oa !== ob) return oa - ob;
      return (a.PONumber || "").localeCompare(b.PONumber || "");
    });
  }, [data]);

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
          <th style={S.th}>PO</th>
          <th style={S.th}>Warehouse</th>
          <th style={S.th}>PO Ordered</th>
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
            <td style={S.td}><span style={Object.assign({}, S.badge(wh === "NJ" ? "blue" : wh.indexOf("Pawtree") >= 0 ? "purple" : "default"))}>{wh}</span></td>
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
  var toast = props.toast;
  var TOOL_COLOR = "#F59E0B";
  var _wh = useState("TP-NY"), whTab = _wh[0], setWhTab = _wh[1];
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _ld = useState(false), loading = _ld[0], setLoading = _ld[1];
  var _q = useState(""), search = _q[0], setSearch = _q[1];
  var _vf = useState("all"), vendorFilter = _vf[0], setVendorFilter = _vf[1];
  var _sf = useState("all"), statusFilter = _sf[0], setStatusFilter = _sf[1];
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);

  var fetchSheet = useCallback(function(wh) {
    setLoading(true);
    fetch("/api/sheets?wh=" + encodeURIComponent(wh) + "&_t=" + Date.now(), { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.error) { toast(json.error, "error"); setData([]); }
        else { setData(json.data || []); toast("Loaded " + (json.count || 0) + " items for " + wh); }
      })
      .catch(function(err) { toast("Error: " + err.message, "error"); })
      .finally(function() { setLoading(false); });
  }, [toast]);

  useEffect(function() { fetchSheet(whTab); }, [whTab]);

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
      <button onClick={function() { fetchSheet(whTab); }} disabled={loading} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>{loading ? <><Spinner color={TOOL_COLOR} size={14} /> Refreshing...</> : <><IconRefresh /> Refresh</>}</button>
      <span style={{ fontSize: 12, color: "#6B7280" }}>{filtered.length}/{data.length}</span>
    </div>

    {/* Table */}
    {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 320px)" })}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
        <thead><tr>
          <th style={S.th}>Supplier</th>
          <th style={S.th}>NDC</th>
          <th style={Object.assign({}, S.th, { minWidth: 200 })}>Product Description</th>
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
          return <tr key={i}>
            <td style={Object.assign({}, S.td, { color: "#1F2937", fontWeight: 500 })}>{r["Supplier"]}</td>
            <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" })}>{r["NDC"]}</td>
            <td style={S.td}>{r["Product Description"]}</td>
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

/* ═══════ TRUCKLOADER TOOL ═══════ */
function TruckloaderTool(props) {
  var toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred;
  var TOOL_COLOR = "#D97706";
  var TARGET = 42500;
  var MIN_WEIGHT = 35000;
  var TRUCK_COLORS = ["#d9ead3","#cfe2f3","#fff2cc","#f4cccc","#ead1dc","#d9d2e9","#fce5cd","#d0e0e3","#ccddff","#ccffcc","#ffe5cc","#e5ccff"];
  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);

  var _wh = useState("HILL-CP-CA"), warehouse = _wh[0], setWarehouse = _wh[1];
  var _hm = useState(null), hillsMaster = _hm[0], setHillsMaster = _hm[1];
  var _hmLoad = useState(true), hmLoading = _hmLoad[0], setHmLoading = _hmLoad[1];
  var _replen = useState([]), replenData = _replen[0], setReplenData = _replen[1];
  var _rLoad = useState(false), replenLoading = _rLoad[0], setReplenLoading = _rLoad[1];
  var _order = useState([]), orderItems = _order[0], setOrderItems = _order[1];
  var _trucks = useState(null), truckGroups = _trucks[0], setTruckGroups = _trucks[1];
  var _step = useState("order"), step = _step[0], setStep = _step[1];
  var _nsDoh = useState(null), netstockDoh = _nsDoh[0], setNetstockDoh = _nsDoh[1];
  var _fills = useState(null), fillSuggestions = _fills[0], setFillSuggestions = _fills[1];
  var _highlight = useState("all"), highlightTruck = _highlight[0], setHighlightTruck = _highlight[1];
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
    try {
      var rows = await fetchAcumatica("replenishment-needs", warehouse, cred.username, cred.password);
      setReplenData(rows);
      // Filter: QtyAvail + OnPO <= ReorderPoint (match Prepare Replenishment)
      var filtered = rows.filter(function(r) {
        var avail = parseFloat(r.QtyAvailable) || 0;
        var onPO = parseFloat(r.OnPO) || 0;
        var reorder = parseFloat(r.ReorderPoint) || 0;
        return (avail + onPO) <= reorder && reorder > 0;
      });
      // Build order items with Hills Master lookup
      var items = filtered.map(function(r) {
        var id = String(r.InventoryID || "").trim();
        var hm = hmLookup[id] || {};
        var maxQty = parseFloat(r.MaxQty) || 0;
        var avail = parseFloat(r.QtyAvailable) || 0;
        var caseNeed = Math.max(0, Math.round(maxQty - avail));
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
    var items = orderItems.slice();
    items.splice(idx, 1);
    setOrderItems(items);
    setTruckGroups(null);
  }

  // Bin-packing truck optimizer
  function optimizeTrucks() {
    if (orderItems.length === 0) { toast("No items to optimize", "error"); return; }
    var target = TARGET * 100;
    var minW = MIN_WEIGHT * 100;
    var available = [];
    var errors = [];
    orderItems.forEach(function(item, idx) {
      var weight = Math.round(item.totalLbs * 100);
      if (weight <= 0) return;
      if (weight > target) {
        if (item.lbsPerPallet > 0 && item.roundedPallets > 0) {
          var maxPals = Math.floor(target / Math.round(item.lbsPerPallet * 100));
          var remainder = item.roundedPallets - maxPals;
          if (maxPals === 0) { errors.push({ idx: idx, reason: "Single pallet > 42,500 lbs" }); return; }
          var c1 = maxPals * Math.round(item.lbsPerPallet * 100);
          var c2 = remainder * Math.round(item.lbsPerPallet * 100);
          if (c2 > target) { errors.push({ idx: idx, reason: "Too large, needs 2+ splits" }); return; }
          available.push({ weight: c1, idx: idx, isSplit: true, splitPals: maxPals });
          available.push({ weight: c2, idx: idx, isSplit: true, splitPals: remainder });
        } else { errors.push({ idx: idx, reason: "Missing pallet info for split" }); }
      } else {
        available.push({ weight: weight, idx: idx, isSplit: false });
      }
    });
    available.sort(function(a, b) { return b.weight - a.weight; });
    var groups = [];
    available.forEach(function(item) {
      var bestIdx = -1, minGap = target + 1;
      for (var i = 0; i < groups.length; i++) {
        var gap = target - (groups[i].total + item.weight);
        if (gap >= 0 && gap < minGap) { bestIdx = i; minGap = gap; }
      }
      if (bestIdx !== -1) { groups[bestIdx].items.push(item); groups[bestIdx].total += item.weight; }
      else { groups.push({ items: [item], total: item.weight }); }
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
    setStep("trucks");
    var underFill = trucks.filter(function(t) { return t.needsFill; }).length;
    if (underFill > 0) toast(trucks.length + " trucks created. " + underFill + " flagged to fill (<35k lbs)", "info");
    else toast(trucks.length + " trucks optimized!");
  }

  // CSV export for a single truck
  function exportTruckCSV(truck, whShort) {
    var now = new Date();
    var dateStr = (now.getMonth() + 1) + "." + ("0" + now.getDate()).slice(-2) + "." + String(now.getFullYear()).slice(-2);
    var shortCode = warehouse === "HILL-CP-CA" ? "CA" : "NJ";
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
        toast("Netstock DOH loaded: " + items.length + " items");
      } catch (err) { toast("Error parsing Netstock file: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  // Build fill suggestions
  function buildFillSuggestions() {
    if (!netstockDoh || !hillsMaster) { toast("Upload both Netstock DOH and Hills Master first", "error"); return; }
    var orderedIds = {};
    orderItems.forEach(function(it) { orderedIds[it.inventoryID] = true; });
    // Get all GI data (not just filtered) to check replenishment status
    // For now, use replenData which has all items from the GI
    var replenLookup = {};
    replenData.forEach(function(r) { replenLookup[String(r.InventoryID || "").trim()] = r; });
    var candidates = netstockDoh.items.filter(function(ns) {
      if (ns.location !== warehouse) return false;
      if (orderedIds[ns.productCode]) return false;
      return true;
    }).map(function(ns) {
      var hm = hmLookup[ns.productCode] || {};
      var combined = ns.doh + ns.doo;
      return {
        productCode: ns.productCode,
        description: ns.description || hm.description || "",
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
    setFillSuggestions(candidates);
    toast("Found " + candidates.length + " fill candidates for " + warehouse);
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
        <select value={warehouse} onChange={function(e) { setWarehouse(e.target.value); setOrderItems([]); setTruckGroups(null); setFillSuggestions(null); }} style={Object.assign({}, S.sel, { width: "100%", maxWidth: 280 })}>
          <option value="HILL-CP-CA">HILL-CP-CA (California)</option>
          <option value="HILL-CP-NJ">HILL-CP-NJ (New Jersey)</option>
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
      {hasFillFlag && <button onClick={function() { setStep("fill"); }} style={S.pill(step === "fill", "#7C3AED")}>Fill Suggestions</button>}
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
            {["Inventory ID", "Description", "Case Need", "Cases/Pallet", "Pallets", "Order Qty", "Lbs/Pallet", "Total Lbs", ""].map(function(h) {
              return <th key={h} style={S.th}>{h}</th>;
            })}
          </tr></thead>
          <tbody>{orderItems.map(function(it, i) {
            var rowBg = !it.inHillsMaster ? "#FEF2F2" : i % 2 === 0 ? "#fff" : "#FAFAFA";
            return <tr key={it.inventoryID + "-" + i}>
              <td style={Object.assign({}, S.td, { background: rowBg, fontFamily: "monospace", fontSize: 12, fontWeight: 600 })}>{it.inventoryID}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })} title={it.description}>{it.description}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, width: 90 })}>
                <input type="number" min="0" value={it.caseNeed} onChange={function(e) { updateCaseNeed(i, e.target.value); }} style={Object.assign({}, S.inp, { width: 70, textAlign: "right", padding: "4px 8px" })} />
              </td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "right" })}>{it.casesPerPallet || "—"}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "right", fontWeight: 600 })}>{it.roundedPallets}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "right" })}>{it.orderQty}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "right" })}>{it.lbsPerPallet ? it.lbsPerPallet.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, textAlign: "right", fontWeight: 600, color: it.totalLbs > TARGET ? "#DC2626" : "#374151" })}>{it.totalLbs ? it.totalLbs.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</td>
              <td style={Object.assign({}, S.td, { background: rowBg, width: 40 })}>
                <button onClick={function() { removeItem(i); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#DC2626", fontSize: 14 }}>{"\u2715"}</button>
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
        </div>
      </div>

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
              </tr></thead>
              <tbody>{t.assignments.map(function(a, ai) {
                return <tr key={ai} style={{ background: t.color + "30" }}>
                  <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 12, fontWeight: 600 })}>{a.inventoryID}</td>
                  <td style={Object.assign({}, S.td, { maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })} title={a.description}>{a.description}{a.isSplit ? <span style={Object.assign({}, S.badge("purple"), { marginLeft: 6, fontSize: 10 })}>SPLIT</span> : ""}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right" })}>{a.orderQty}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right" })}>{a.pallets}</td>
                  <td style={Object.assign({}, S.td, { textAlign: "right", fontWeight: 600 })}>{a.lbs ? a.lbs.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " lbs" : "—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>;
      })}
    </div>}

    {/* FILL SUGGESTIONS */}
    {step === "fill" && <div>
      <div style={Object.assign({}, S.card, { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" })}>
        <span style={{ fontWeight: 600, color: "#374151" }}>Fill Suggestions — {warehouse}</span>
        <button onClick={function() { nsFileRef.current && nsFileRef.current.click(); }} style={S.btn("ghost")}><IconUpload /> Upload Netstock DOH</button>
        <input ref={nsFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleNetstockUpload} style={{ display: "none" }} />
        {netstockDoh && <span style={S.badge("success")}><IconCheck /> {netstockDoh.items.length} items ({netstockDoh.fileName})</span>}
        {netstockDoh && <button onClick={buildFillSuggestions} style={S.btn()}><IconFilter /> Build Suggestions</button>}
      </div>
      {fillSuggestions && fillSuggestions.length > 0 && <div style={Object.assign({}, S.card, { marginTop: 0 })}>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 12 }}>Sorted by Days on Hand + Days on Order (lowest = most urgent). {fillSuggestions.length} items.</div>
        <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid #E5E7EB", maxHeight: 500 }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 800 }}>
            <thead><tr>
              {["Product Code", "Description", "Class", "Velocity", "DOH", "DOO", "DOH+DOO", "On Hand", "Pallet Wt"].map(function(h) {
                return <th key={h} style={S.th}>{h}</th>;
              })}
            </tr></thead>
            <tbody>{fillSuggestions.slice(0, 100).map(function(f, fi) {
              var urgencyBg = f.combined === 0 ? "#FEF2F2" : f.combined <= 14 ? "#FFF7ED" : f.combined <= 30 ? "#FFFBEB" : "#F0FDF4";
              var urgencyColor = f.combined === 0 ? "#DC2626" : f.combined <= 14 ? "#EA580C" : f.combined <= 30 ? "#CA8A04" : "#16A34A";
              return <tr key={fi}>
                <td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 12, fontWeight: 600 })}>{f.productCode}</td>
                <td style={Object.assign({}, S.td, { maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })} title={f.description}>{f.description}</td>
                <td style={Object.assign({}, S.td, { textAlign: "center", fontWeight: 600 })}>{f.netClass}</td>
                <td style={Object.assign({}, S.td, { textAlign: "center" })}>{f.velocity}</td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}>{f.doh}</td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}>{f.doo}</td>
                <td style={Object.assign({}, S.td, { textAlign: "right", fontWeight: 700, background: urgencyBg, color: urgencyColor })}>{f.combined}</td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}>{f.onHand}</td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}>{f.palletWeight ? f.palletWeight.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>}
      {fillSuggestions && fillSuggestions.length === 0 && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 40, color: "#9CA3AF" })}>No fill candidates found for {warehouse}.</div>}
    </div>}

    {/* EMPTY STATE */}
    {orderItems.length === 0 && !replenLoading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#9CA3AF" })}>
      <IconBox /><br /><br />
      {hillsMaster ? "Select warehouse and click Fetch Replenishment to load items." : "Upload Hills Master XLSX to get started."}
    </div>}
  </div>;
}
/* ═══════ MAIN HUB ═══════ */
export default function Hub() {
  var _p = useState(function() { var s = sGet("active-page"); return s || "TP-NY"; }), page = _p[0], setPage = _p[1];
  function setPagePersist(p) { setPage(p); sSet("active-page", p); }
  var _c = useState({ username: "", password: "" }), cred = _c[0], setCred = _c[1];
  var _ok = useState(false), ok = _ok[0], setOk = _ok[1];
  var _sl = useState(false), showLogin = _sl[0], setShowLogin = _sl[1];
  var _t = useState(null), toast = _t[0], setToast = _t[1];
  var _cl = useState(true), credLoading = _cl[0], setCredLoading = _cl[1];
  var _gm = useState(null), gmail = _gm[0], setGmail = _gm[1];
  var _sr = useState(function() { var saved = sGet("shipping-rules-v2"); return saved || Object.assign({}, DEFAULT_SHIP_RULES); }), shipRules = _sr[0], setShipRules = _sr[1];
  var _sideCol = useState(function() { return sGet("sidebar-collapsed") || {}; }), sideCollapsed = _sideCol[0], setSideCollapsed = _sideCol[1];
  function toggleSection(key) { var u = Object.assign({}, sideCollapsed); u[key] = !u[key]; setSideCollapsed(u); sSet("sidebar-collapsed", u); }
  function updateShipRules(newRules) { setShipRules(newRules); sSet("shipping-rules-v2", newRules); }

  var showToast = useCallback(function(m, t) { setToast({ m: m, t: t || "success" }); setTimeout(function() { setToast(null); }, 3500); }, []);
  useEffect(function() { var mt = true; (async function() { var s = sGet("user-credentials"); if (mt && s && s.username && s.password) { setCred(s); setOk(true); } var g = getGmailToken(); if (mt && g && g.token) { setGmail(g); } if (mt) setCredLoading(false); })(); return function() { mt = false; }; }, []);

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
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1F2937", margin: "0 0 4px" }}>Inventory Hub</h1>
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
  var activeColor = isWH ? WH[page].color : page === "short-dating" ? "#E879F9" : page === "backorder" ? "#F97316" : page === "po-import" ? "#06B6D4" : page === "cycle-count" ? "#14B8A6" : page === "fuze-tracker" ? "#F59E0B" : page === "hills-pawtree" ? "#10B981" : page === "truckloader" ? "#D97706" : "#3B82F6";
  var activeLabel = isWH ? WH[page].full : page === "short-dating" ? "Short-Dating Tracker" : page === "backorder" ? "Backorder Tracker" : page === "po-import" ? "PO NDC Validator" : page === "cycle-count" ? "Cycle Counting" : page === "fuze-tracker" ? "Fuze Tracker" : page === "hills-pawtree" ? "Hills & Pawtree Tracker" : page === "truckloader" ? "Truckloader" : showLogin ? "Login" : "Shipping Rules";

  function SideLink(p) {
    var active = page === p.id && !showLogin;
    return <div onClick={function() { setPagePersist(p.id); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", margin: "1px 12px", fontSize: 13, cursor: "pointer", transition: "all 0.15s", fontWeight: active ? 500 : 400, color: active ? "#93bbfc" : "rgba(255,255,255,0.55)", background: active ? "rgba(96,165,250,0.15)" : "transparent", borderRadius: 8 }}><Dot color={p.color} />{p.label}</div>;
  }

  return (
    <div style={{ fontFamily: "'Varela Round',sans-serif", background: "#F8F9FB", color: "#374151", minHeight: "100vh", display: "flex" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Varela+Round&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#F8F9FB}::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.08)}input:focus,select:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.12)}tr:hover td{background:rgba(59,130,246,0.02)}`}</style>

      <div style={{ width: 230, background: "#1A1F2E", display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0 }}>
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 8 }}>
          <p style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.5px", color: "#FFFFFF", margin: 0 }}>Inventory Hub</p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 4 }}>Vetcove Tools</p>
        </div>
        {(function() {
          var sections = [
            { key: "po", label: "PO Tools", items: Object.entries(WH).map(function(e) { return { id: e[0], label: e[1].full, color: e[1].color }; }) },
            { key: "generic", label: "Generic PO Tools", items: [{ id: "po-import", label: "PO NDC Validator", color: "#06B6D4" }, { id: "cycle-count", label: "Cycle Counting", color: "#14B8A6" }] },
            { key: "tracking", label: "Tracking", items: [{ id: "hills-pawtree", label: "Hills & Pawtree", color: "#10B981" }, { id: "fuze-tracker", label: "Fuze Tracker", color: "#F59E0B" }] },
            { key: "hills", label: "Hills Tools", items: [{ id: "truckloader", label: "Truckloader", color: "#D97706" }] },
            { key: "inventory", label: "Inventory Tools", items: [{ id: "short-dating", label: "Short-Dating", color: "#E879F9" }, { id: "backorder", label: "Backorders", color: "#F97316" }] },
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
          <div onClick={function() { setPagePersist("rules"); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", margin: "1px 12px", fontSize: 13, cursor: "pointer", fontWeight: page === "rules" && !showLogin ? 500 : 400, color: page === "rules" && !showLogin ? "#93bbfc" : "rgba(255,255,255,0.55)", background: page === "rules" && !showLogin ? "rgba(96,165,250,0.15)" : "transparent", borderRadius: 8 }}><IconTruck /> Shipping Rules</div>
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{!showLogin && <Dot color={activeColor} />}<span style={{ fontSize: 18, fontWeight: 500, color: "#1F2937" }}>{showLogin ? "Acumatica Login" : activeLabel}</span>{isWH && !showLogin && <span style={{ fontSize: 11, background: activeColor + "15", color: activeColor, padding: "3px 10px", borderRadius: 6, fontWeight: 500 }}>{page}</span>}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{!ok && !showLogin && <span style={{ fontSize: 12, color: "#DC2626", display: "flex", alignItems: "center", gap: 4 }}><IconLock /> View only</span>}<span style={{ fontSize: 12, color: "#6B7280" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></div>
        </div>
        <div style={{ padding: 32, flex: 1 }}>
          {showLogin && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}><div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 32, width: 400, textAlign: "center" }}><div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><IconKey /></div><h2 style={{ fontSize: 20, fontWeight: 700, color: "#1F2937", margin: "0 0 4px" }}>Acumatica Login</h2><p style={{ color: "#9CA3AF", fontSize: 11, margin: "0 0 24px" }}>Shared across all tools</p><div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}><div><label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 4 }}>Username</label><input style={{ background: "#F8F9FB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", color: "#374151", fontSize: 13, outline: "none", width: "100%" }} value={cred.username} onChange={function(e) { setCred({ username: e.target.value, password: cred.password }); }} placeholder="your.username" /></div><div><label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 4 }}>Password</label><input style={{ background: "#F8F9FB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", color: "#374151", fontSize: 13, outline: "none", width: "100%" }} type="password" value={cred.password} onChange={function(e) { setCred({ username: cred.username, password: e.target.value }); }} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" /></div><button onClick={login} disabled={loginLoading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: loginLoading ? "wait" : "pointer", marginTop: 8, opacity: loginLoading ? 0.7 : 1 }}>{loginLoading ? <><Spinner color="#fff" size={14} /> Verifying...</> : "Connect"}</button></div></div></div>}

          {page === "rules" && !showLogin && <div>
            <p style={{ color: "#6B7280", fontSize: 13, marginBottom: 16 }}>Vendor shipping rules for PO warehouses. Rules are saved to your browser.</p>
            <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "auto", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead><tr>
                  <th style={{ padding: "12px 14px", textAlign: "left", background: "#F9FAFB", color: "#9CA3AF", fontWeight: 600, fontSize: 13, textTransform: "uppercase", borderBottom: "2px solid #E5E7EB" }}>Vendor</th>
                  <th style={{ padding: "12px 14px", textAlign: "left", background: "#F9FAFB", color: "#9CA3AF", fontWeight: 600, fontSize: 13, textTransform: "uppercase", borderBottom: "2px solid #E5E7EB" }}>Rule</th>
                  <th style={{ padding: "12px 14px", textAlign: "center", background: "#F9FAFB", color: "#9CA3AF", fontWeight: 600, fontSize: 13, textTransform: "uppercase", borderBottom: "2px solid #E5E7EB", width: 60 }}></th>
                </tr></thead>
                <tbody>{Object.entries(shipRules).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) {
                  return <tr key={e[0]}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F3F4F6", color: "#374151", fontSize: 14 }}>{e[0]}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6" }}>
                      <input style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", color: "#374151", fontSize: 13, outline: "none", width: "100%", fontFamily: "'Varela Round', sans-serif" }} value={e[1]} onChange={function(ev) { var updated = Object.assign({}, shipRules); updated[e[0]] = ev.target.value; updateShipRules(updated); }} />
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F3F4F6", textAlign: "center" }}>
                      <button onClick={function() { var updated = Object.assign({}, shipRules); delete updated[e[0]]; updateShipRules(updated); showToast("Removed " + e[0]); }} style={{ background: "transparent", border: "1px solid #E5E7EB", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#DC2626", cursor: "pointer" }}>{"\u2715"}</button>
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 20, display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 4 }}>Vendor Name</label>
                <input id="new-vendor-name" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", color: "#374151", fontSize: 14, outline: "none", width: "100%", fontFamily: "'Varela Round', sans-serif" }} placeholder="e.g. Zoetis US LLC" />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500, display: "block", marginBottom: 4 }}>Rule</label>
                <input id="new-vendor-rule" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", color: "#374151", fontSize: 14, outline: "none", width: "100%", fontFamily: "'Varela Round', sans-serif" }} placeholder="e.g. min:5000; message:Free Shipping; else:Not Free Shipping" />
              </div>
              <button onClick={function() { var nameEl = document.getElementById("new-vendor-name"); var ruleEl = document.getElementById("new-vendor-rule"); var name = (nameEl.value || "").trim(); var rule = (ruleEl.value || "").trim(); if (!name) { showToast("Enter a vendor name", "error"); return; } if (!rule) { showToast("Enter a rule", "error"); return; } var updated = Object.assign({}, shipRules); updated[name] = rule; updateShipRules(updated); nameEl.value = ""; ruleEl.value = ""; showToast("Added " + name); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#3B82F6", color: "#fff", flexShrink: 0 }}>+ Add</button>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <button onClick={function() { updateShipRules(Object.assign({}, DEFAULT_SHIP_RULES)); showToast("Reset to defaults"); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "#6B7280" }}>Reset to Defaults</button>
              <span style={{ fontSize: 12, color: "#B5AEA5", alignSelf: "center" }}>{Object.keys(shipRules).length} vendors</span>
            </div>
          </div>}

          {!showLogin && Object.entries(WH).map(function(e) { return <div key={e[0]} style={{ display: page === e[0] ? "block" : "none" }}><WHT whKey={e[0]} cfg={e[1]} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} shipRules={shipRules} /></div>; })}
          {!showLogin && page === "short-dating" && <TrackerTool toolKey="short-dating" toolLabel="Short-Dating Tracker" toolColor="#E879F9" demoData={SD_DEMO} columns={sdColumns} emailConfig={sdEmail} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} />}
          {!showLogin && page === "backorder" && <TrackerTool toolKey="backorder" toolLabel="Backorder Tracker" toolColor="#F97316" demoData={BKO_DEMO} columns={bkoColumns} emailConfig={bkoEmail} skipVendors={BKO_SKIP} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} />}
          {!showLogin && page === "po-import" && <POImportTool toast={showToast} cred={cred} ok={ok} lp={promptLogin} />}
          {!showLogin && page === "cycle-count" && <CycleCountTool key="cc-standard" toast={showToast} />}
          {!showLogin && page === "fuze-tracker" && <FuzeTracker toast={showToast} />}
          {!showLogin && page === "hills-pawtree" && <HillsTracker toast={showToast} ok={ok} lp={promptLogin} cred={cred} />}
          {!showLogin && page === "truckloader" && <TruckloaderTool toast={showToast} ok={ok} lp={promptLogin} cred={cred} />}
        </div>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#FFFFFF", color: toast.t === "success" || toast.t === "error" ? "#fff" : "#1F2937", border: "1px solid " + (toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#E5E7EB"), boxShadow: "0 4px 20px rgba(44,40,37,0.12)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );
}
