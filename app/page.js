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

/* ═══════ API HELPERS ═══════ */
async function fetchAcumatica(type, warehouse, username, password) {
  const resp = await fetch("/api/acumatica", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, warehouse, username, password }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || "Acumatica request failed");
  if (json._debug) console.log("[Acumatica Debug]", JSON.stringify(json._debug, null, 2));
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
  let result = "", meetsMin = true, matchedRange = false, fb = "Free Shipping";
  for (const p of parts) {
    if (p.startsWith("min:")) {
      if (total < parseFloat(p.replace("min:", ""))) meetsMin = false;
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
  return result || (meetsMin ? fb : "Will not ship");
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
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: "1.5px solid #A69E95", color: "#A69E95", fontSize: 11, fontWeight: 700, cursor: "help", flexShrink: 0, lineHeight: 1 }}>i</span>
    {show && <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "#2C2825", color: "#fff", fontSize: 12, lineHeight: 1.4, padding: "8px 12px", borderRadius: 8, whiteSpace: "normal", width: 240, zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", pointerEvents: "none" }}>{text}<span style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "6px solid #2C2825" }} /></span>}
  </span>;
}

/* ═══════ STYLES ═══════ */
function makeStyles(accent) {
  return {
    card: { background: "#FFFFFF", border: "1px solid #E8E4DE", borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: "0 1px 4px rgba(44,40,37,0.05)" },
    statCard: { background: "#FFFFFF", border: "1px solid #E8E4DE", borderRadius: 16, padding: "20px 24px", flex: 1, minWidth: 160, position: "relative", overflow: "hidden", boxShadow: "0 1px 4px rgba(44,40,37,0.05)" },
    btn: function(v) {
      var base = { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" };
      if (v === "danger") return Object.assign({}, base, { background: "#DC2626", color: "#fff" });
      if (v === "ghost") return Object.assign({}, base, { background: "transparent", color: "#8A8279", border: "1px solid #E8E4DE" });
      return Object.assign({}, base, { background: accent, color: "#fff" });
    },
    inp: { background: "#F8F6F3", border: "1px solid #E8E4DE", borderRadius: 10, padding: "10px 14px", color: "#2C2825", fontSize: 14, outline: "none", width: "100%" },
    sel: { background: "#F8F6F3", border: "1px solid #E8E4DE", borderRadius: 10, padding: "10px 14px", color: "#2C2825", fontSize: 14, outline: "none" },
    th: { padding: "14px 14px", textAlign: "left", background: "#F5F3EF", color: "#9A928A", fontWeight: 600, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.3px", borderBottom: "2px solid #E8E4DE", position: "sticky", top: 0, zIndex: 2 },
    td: { padding: "14px 14px", borderBottom: "1px solid #F0EDE8", color: "#4A4541", fontSize: 14 },
    badge: function(t) {
      var base = { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 };
      var colors = { success: ["#ECFDF5", "#059669"], danger: ["#FEF2F2", "#DC2626"], warning: ["#FFFBEB", "#D97706"], purple: ["#F5F3FF", "#7C3AED"], blue: ["#EFF6FF", "#2563EB"] };
      var c = colors[t] || ["#F5F3EF", "#8A8279"];
      return Object.assign({}, base, { background: c[0], color: c[1] });
    },
    pill: function(active, col) {
      return { padding: "10px 20px", borderRadius: 10, fontSize: 15, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6, background: active ? (col || accent) : "transparent", color: active ? "#fff" : "#9A928A" };
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
      style={{ cursor: "pointer", padding: "6px 10px", borderRadius: 8, wordBreak: "break-word", lineHeight: 1.4, color: color || "#4A4541", display: "flex", alignItems: "flex-start", gap: 6, background: copied ? "#ECFDF5" : "#F8F6F3", border: "1px solid " + (copied ? "#059669" : "#E8E4DE"), transition: "all 0.2s" }}>
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

  if (initLoading) return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#8A8279" })}><Spinner color={toolColor} size={20} /></div>;

  var ToolIcon = toolKey === "backorder" ? IconBox : IconClock;
  var dataLabel = toolKey === "backorder" ? "Backorder Data" : "Short Data";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "#FAFAF8", borderRadius: 10, padding: 3 }}>
          <button onClick={function() { setSubPage("data"); }} style={S.pill(subPage === "data", toolColor)}>{dataLabel}{data.length > 0 && <span style={{ fontSize: 10, background: subPage === "data" ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4 }}>{data.length}</span>}</button>
          <button onClick={function() { if (!ok) { lp(); return; } setSubPage("emails"); }} style={Object.assign({}, S.pill(subPage === "emails", toolColor), !ok ? { opacity: 0.5 } : {})}>{!ok && <IconLock />} Email Drafts</button>
          <button onClick={function() { if (!ok) { lp(); return; } setSubPage("contacts"); }} style={Object.assign({}, S.pill(subPage === "contacts", toolColor), !ok ? { opacity: 0.5 } : {})}>{!ok && <IconLock />} Vendor Contacts</button>
        </div>
        <div style={{ flex: 1 }} />
        {runTime && <span style={{ fontSize: 11, color: "#A69E95" }}>Last: {runTime}{runBy ? " by " + runBy : ""}</span>}
        {data.length > 0 && <span style={S.badge(drafts > 0 ? "success" : "default")}>{drafts > 0 ? <><IconCheck /> {drafts} drafts</> : data.length + " items"}</span>}
        {data.length > 0 && (confirmClear
          ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: "#DC2626" }}>Clear?</span><button onClick={clearAll} style={Object.assign({}, S.btn("danger"), { padding: "6px 14px", fontSize: 12 })}>Yes</button><button onClick={function() { setConfirmClear(false); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>No</button></div>
          : <button onClick={function() { setConfirmClear(true); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12, color: "#8A8279" })}><IconTrash /> Clear</button>
        )}
      </div>

      {subPage === "data" && <div>
        <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 16, padding: "16px 24px" })}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: toolColor + "20", display: "flex", alignItems: "center", justifyContent: "center", color: toolColor }}><ToolIcon /></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#2C2825" }}>{toolLabel}</div><div style={{ fontSize: 12, color: "#8A8279" }}>{data.length > 0 ? data.length + " items across " + uniqueVendors.length + " vendors" : "No data synced"}</div></div>
          <button style={Object.assign({}, S.btn(), { padding: "10px 24px" })} onClick={syncData} disabled={loading}>{loading ? <><Spinner /> Syncing...</> : <><IconRefresh /> {data.length > 0 ? "Re-sync" : "Sync Data"}</>}</button>
        </div>
        {data.length > 0 && <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
            <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
            <div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: "#8A8279" }}>{filtered.length}/{data.length}</span>
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
        {data.length === 0 && !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#A69E95" })}><ToolIcon /><p style={{ marginTop: 12, fontSize: 14 }}>Click <strong>Sync Data</strong> to pull {toolLabel.toLowerCase()} from Acumatica.</p></div>}
      </div>}

      {subPage === "emails" && <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#2C2825", margin: "0 0 4px" }}>{emailConfig.title}</h3>
        <p style={{ color: "#8A8279", fontSize: 12, margin: "0 0 16px" }}>{emailConfig.subtitle}</p>
        {skipVendors.length > 0 && <div style={{ background: "rgba(100,116,139,0.06)", border: "1px solid #E8E4DE", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#8A8279" }}>Skipped: {skipVendors.join(", ")}</div>}
        {drafts > 0 && <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconCheck /><span style={{ fontSize: 13, color: "#059669" }}><strong>{drafts} draft(s) created!</strong></span></div>}
        {data.length > 0 ? <>
          {emailVendors.map(function(entry) {
            var vendor = entry[0], items = entry[1];
            var email = CONTACTS[vendor] || "";
            var toLine = emailConfig.buildTo(email);
            return <div key={vendor} style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: "#2C2825" }}>{vendor}</div><div style={{ fontSize: 11, color: "#8A8279", marginTop: 2 }}>{items.length} items &middot; To: {toLine || "No email on file"}</div></div>
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
        </> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#A69E95" })}>Sync data first.</div>}
      </div>}

      {subPage === "contacts" && <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#2C2825", margin: "0 0 16px" }}>Vendor Contacts</h3>
        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
            <thead><tr><th style={S.th}>Vendor</th><th style={S.th}>Email(s)</th></tr></thead>
            <tbody>{Object.entries(CONTACTS).filter(function(e) { return e[1]; }).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) { return <tr key={e[0]}><td style={Object.assign({}, S.td, { fontWeight: 500, color: "#4A4541" })}>{e[0]}</td><td style={Object.assign({}, S.td, { fontSize: 14, color: "#8A8279" })}>{e[1]}</td></tr>; })}</tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

/* ═══════ PO WAREHOUSE TOOL ═══════ */
function WHT(props) {
  var whKey = props.whKey, cfg = props.cfg, toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred, gmail = props.gmail, SHIP_RULES = props.shipRules || {};
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
  var _il = useState(true), initLoading = _il[0], setInitLoading = _il[1];
  var S = useMemo(function() { return makeStyles(cfg.color); }, [cfg.color]);
  var kvKey = "po:" + whKey;

  // Load from KV on mount
  useEffect(function() {
    var m = true;
    (async function() {
      try {
        var resp = await fetch("/api/kv?key=" + encodeURIComponent(kvKey));
        var json = await resp.json();
        if (m && json.data && json.data.data && json.data.data.length > 0) {
          setData(json.data.data); setEmailSent(json.data.emailSent || false); setRunBy(json.data.runBy || null); setRunTime(json.data.runTime || null); setShipNotes(json.data.shipNotes || {});
        }
      } catch (e) {
        // Fallback to localStorage
        var s = sGet("wh-data-" + whKey);
        if (m && s && s.data && s.data.length > 0) { setData(s.data); setEmailSent(s.emailSent || false); setRunBy(s.runBy || null); setRunTime(s.runTime || null); setShipNotes(s.shipNotes || {}); }
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
        var resp = await fetch("/api/kv?key=" + encodeURIComponent(kvKey));
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

  var persist = useCallback(async function(d, es, by, time, sn) {
    var payload = { data: d, emailSent: es, runBy: by, runTime: time, shipNotes: sn || {} };
    // Save to localStorage as cache
    sSet("wh-data-" + whKey, payload);
    // Save to KV for sharing
    try { await fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: kvKey, value: payload }) }); } catch (e) {}
  }, [kvKey, whKey]);
  var fetchData = useCallback(function() {
    if (!ok) { lp(); return; } setLoading(true); setEmailSent(false); setConfirmClear(false);
    (async function() {
      try {
        var raw;
        if (cred && cred.username && cred.password) {
          raw = await fetchAcumatica(whKey === "GGM-KY" ? "po-ggm" : "po", whKey, cred.username, cred.password);
        } else {
          raw = PO_DEMO[whKey] || [];
        }
        var excluded = whKey === "GGM-KY" ? EXCLUDED.filter(function(ex) { return ex !== "vetcove generics"; }) : EXCLUDED;
        var rows = raw.filter(function(r) { return r.SKUNDC && (r.Warehouse || "").trim() === whKey && !excluded.some(function(ex) { return (r.VendorName || "").toLowerCase().indexOf(ex) >= 0; }); }).map(function(r) { return Object.assign({}, r, { Price: Number(r.Price) || 0, OrderQty: Number(r.OrderQty) || 0, TotalPrice: +((Number(r.Price) || 0) * (Number(r.OrderQty) || 0)).toFixed(2) }); });
        var now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        var who = cred && cred.username ? cred.username : "You";
        setData(rows); setRunBy(who); setRunTime(now); setLoading(false); setSubPage("data"); persist(rows, false, who, now, {}); setShipNotes({}); toast(cfg.label + ": Fetched " + rows.length + " lines");
      } catch (err) {
        setLoading(false);
        toast("Error: " + err.message, "error");
      }
    })();
  }, [whKey, cred, cfg.label, toast, ok, lp, persist]);
  var clearAll = useCallback(async function() { if (!ok) { lp(); return; } setData([]); setSearch(""); setVendorFilter("all"); setFlagsOnly(false); setEmailSent(false); setConfirmClear(false); setRunBy(null); setRunTime(null); setSubPage("overview"); setShipNotes({}); sDel("wh-data-" + whKey); try { await fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: kvKey, value: {} }) }); } catch (e) {} toast(cfg.label + ": Cleared"); }, [cfg.label, toast, ok, lp, kvKey, whKey]);

  var vendorGroups = useMemo(function() { var g = {}; data.forEach(function(r) { if (!g[r.VendorName]) g[r.VendorName] = []; g[r.VendorName].push(r); }); return g; }, [data]);
  var vendorTotals = useMemo(function() { var t = {}; Object.entries(vendorGroups).forEach(function(e) { t[e[0]] = e[1].reduce(function(s, r) { return s + r.TotalPrice; }, 0); }); return t; }, [vendorGroups]);
  var uniqueVendors = useMemo(function() { return Array.from(new Set(data.map(function(r) { return r.VendorName; }))).sort(); }, [data]);
  var totalVal = useMemo(function() { return data.reduce(function(s, r) { return s + r.TotalPrice; }, 0); }, [data]);
  var flags = useMemo(function() { var f = { s: [], so: [] }; data.forEach(function(r, i) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") f.s.push(i); if (mc === "sell-off item") f.so.push(i); }); return f; }, [data]);
  var flagCount = flags.s.length + flags.so.length;
  var emailBlocked = whKey !== "GGM-KY" && (flags.s.length > 0 || flags.so.length > 0);
  var getFlag = function(r) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") return "short"; if (mc === "sell-off item") return "selloff"; return null; };
  var filtered = useMemo(function() { var d = data.slice(); if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return r.SKUNDC.toLowerCase().indexOf(s) >= 0 || r.Description.toLowerCase().indexOf(s) >= 0 || r.VendorName.toLowerCase().indexOf(s) >= 0; }); } if (vendorFilter !== "all") d = d.filter(function(r) { return r.VendorName === vendorFilter; }); if (flagsOnly) { var fi = new Set(flags.s.concat(flags.so)); d = d.filter(function(r) { return fi.has(data.indexOf(r)); }); } d.sort(function(a, b) { var fa = getFlag(a) ? 0 : 1; var fb = getFlag(b) ? 0 : 1; return fa - fb; }); return d; }, [data, search, vendorFilter, flagsOnly, flags]);
  var todayStr = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

  if (initLoading) return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#8A8279" })}><Spinner color={cfg.color} size={20} /></div>;

  return (<div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 4, background: "#FAFAF8", borderRadius: 10, padding: 3 }}>
        {[{ id: "overview", lb: "Overview" }, { id: "data", lb: "PO Data", ct: data.length || null }, { id: "shipping", lb: "Shipping" }, { id: "email", lb: "Email" }].map(function(n) { return <button key={n.id} onClick={function() { setSubPage(n.id); }} style={S.pill(subPage === n.id, cfg.color)}>{n.lb}{n.ct ? <span style={{ fontSize: 10, background: subPage === n.id ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4 }}>{n.ct}</span> : null}</button>; })}
      </div>
      <div style={{ flex: 1 }} />
      {runTime && <span style={{ fontSize: 11, color: "#A69E95" }}>Last: {runTime}{runBy ? " by " + runBy : ""}</span>}
      {data.length > 0 && <span style={S.badge(emailSent ? "success" : "default")}>{emailSent ? <><IconCheck /> Sent</> : data.length + " lines"}</span>}
      {data.length > 0 && (confirmClear ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: "#DC2626" }}>Clear?</span><button onClick={clearAll} style={Object.assign({}, S.btn("danger"), { padding: "6px 14px", fontSize: 12 })}>Yes</button><button onClick={function() { setConfirmClear(false); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>No</button></div> : <Gate ok={ok} prompt={lp} onClick={function() { setConfirmClear(true); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12, color: "#8A8279" })}><IconTrash /> Clear</Gate>)}
    </div>

    {subPage === "overview" && <div>
      <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 16, padding: "16px 24px" })}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: cfg.color + "20", display: "flex", alignItems: "center", justifyContent: "center", color: cfg.color }}><IconWH /></div>
        <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#2C2825" }}>{cfg.full}</div><div style={{ fontSize: 12, color: "#8A8279" }}>{data.length > 0 ? data.length + " lines · " + uniqueVendors.length + " vendors · $" + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "No data loaded"}</div></div>
        <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 24px" })} onClick={fetchData} disabled={loading}>{loading ? <><Spinner /> Fetching...</> : <><IconRefresh /> {data.length > 0 ? "Re-fetch" : "Run PO Fetch"}</>}</Gate>
      </div>
      {data.length > 0 && <>
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          {[{ l: "Lines", v: data.length, c: cfg.color }, { l: "Vendors", v: uniqueVendors.length, c: "#059669" }, { l: "Value", v: "$" + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 }), c: "#D97706" }, { l: "Flags", v: flagCount || "Clear", c: flagCount ? "#DC2626" : "#059669" }].map(function(s) { return <div key={s.l} style={S.statCard}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: s.c }} /><div style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.l}</div><div style={{ fontSize: 28, fontWeight: 700, color: s.l === "Flags" ? s.c : "#2C2825", marginTop: 4 }}>{s.v}</div></div>; })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          {Object.entries(vendorGroups).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) { var v = e[0], rs = e[1], t = vendorTotals[v], rl = SHIP_RULES[v], st = rl ? evalShip(rl, t) : "No Rule", isFree = st === "Free Shipping", vl = getVendorLabel(v); return <div key={v} style={Object.assign({}, S.card, { padding: "16px 20px", marginBottom: 0 })}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontSize: 13, fontWeight: 600, color: "#2C2825" }}>{v}</div>{vl && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: vl === "Truecommerce" ? "#EFF6FF" : "#FFF7ED", color: vl === "Truecommerce" ? "#2563EB" : "#C2410C", fontWeight: 600 }}>{vl}</span>}</div><div style={{ fontSize: 11, color: "#8A8279", marginTop: 2 }}>{rs.length} lines · {rs[0] && rs[0].OrderNbr}</div></div><div style={{ fontSize: 15, fontWeight: 700, color: "#2C2825" }}>${t.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div><div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}><IconTruck /><span style={S.badge(isFree ? "success" : "danger")}>{isFree ? <IconCheck /> : <IconAlert />}{st}</span></div></div>; })}
        </div>
      </>}
      {data.length === 0 && !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#A69E95" })}><IconWH /><p style={{ marginTop: 12, fontSize: 14 }}>Click <strong>Run PO Fetch</strong> to load data for {cfg.full}.</p></div>}
    </div>}

    {subPage === "data" && <div>
      {flagCount > 0 && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconAlert /><span style={{ fontSize: 13, color: "#DC2626" }}><strong>Flagged:</strong>{flags.s.length > 0 && " " + flags.s.length + " Short-Dating"}{flags.so.length > 0 && " " + flags.so.length + " Sell-Off"}</span></div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
        <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
        <button style={S.btn(flagsOnly ? "danger" : "ghost")} onClick={function() { setFlagsOnly(!flagsOnly); }}><IconFilter /> {flagsOnly ? "Flags" : "Filter Flags"}</button>
        <div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: "#8A8279" }}>{filtered.length}/{data.length}</span>
      </div>
      {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: "calc(100vh - 260px)" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr>{["SKU", "Description", "Qty", "Vendor", "PO #"].concat(whKey !== "GGM-KY" ? ["Reorder", "Max", "Lead", "Min", "Avail"] : []).concat(["Price", "Total", "Flag"]).map(function(h) { return <th key={h} style={S.th}>{h}</th>; })}</tr></thead>
          <tbody>{filtered.map(function(r, i) { var f = getFlag(r); var bg = f === "short" ? "rgba(220,38,38,0.04)" : f === "selloff" ? "rgba(217,119,6,0.04)" : "transparent"; var tc = f === "short" ? "#DC2626" : f === "selloff" ? "#D97706" : "#4A4541"; var fmt = function(v) { var n = parseFloat(v); if (isNaN(n)) return v; return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2); }; return <tr key={i} style={{ background: bg }}><td style={Object.assign({}, S.td, { color: tc })}>{r.SKUNDC}</td><td style={Object.assign({}, S.td, { color: tc, minWidth: 180, maxWidth: 350 })}><CopyCell text={r.Description} toast={toast} color={tc} accentColor={cfg.color} /></td><td style={Object.assign({}, S.td, { color: tc })}>{fmt(r.OrderQty)}</td><td style={Object.assign({}, S.td, { color: tc })}>{r.VendorName}</td><td style={Object.assign({}, S.td, { color: tc })}>{r.OrderNbr}</td>{whKey !== "GGM-KY" && <><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.ReorderPoint)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.MaxQty)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.LeadTime)}d</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{fmt(r.MinOrderQty)}</td><td style={Object.assign({}, S.td, { color: r.QtyAvailable < 0 ? "#DC2626" : tc, textAlign: "right" })}>{fmt(r.QtyAvailable)}</td></>}<td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>${r.Price.toFixed(2)}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>${r.TotalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}>{f ? <span style={S.badge(f === "short" ? "danger" : "warning")}>{f === "short" ? "Short" : "Sell-Off"}</span> : "\u2014"}</td></tr>; })}</tbody>
        </table>
      </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#A69E95" })}>Run fetch first.</div>}
    </div>}

    {subPage === "shipping" && <div>
      {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr><th style={S.th}>Vendor</th><th style={Object.assign({}, S.th, { width: 140 })}>PO #</th><th style={Object.assign({}, S.th, { textAlign: "right" })}>Total</th><th style={S.th}>Shipping</th><th style={Object.assign({}, S.th, { width: 200 })}>Price Check Notes</th></tr></thead>
          <tbody>{Object.keys(vendorGroups).sort().map(function(v) { var t = vendorTotals[v], rl = SHIP_RULES[v] || "", st = rl ? evalShip(rl, t) : "No Rule", isFree = st === "Free Shipping"; var sn = shipNotes[v] || {}; var vl = getVendorLabel(v); return <tr key={v}><td style={Object.assign({}, S.td, { color: "#2C2825" })}><div>{v}</div>{vl && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: vl === "Truecommerce" ? "#EFF6FF" : "#FFF7ED", color: vl === "Truecommerce" ? "#2563EB" : "#C2410C", fontWeight: 600, display: "inline-block", marginTop: 4 }}>{vl}</span>}</td><td style={S.td}><input style={Object.assign({}, S.inp, { padding: "6px 10px" })} placeholder="Paste PO #" value={sn.po || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[v] = Object.assign({}, sn, { po: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} /></td><td style={Object.assign({}, S.td, { textAlign: "right" })}>${t.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}><span style={S.badge(isFree ? "success" : "danger")}>{isFree ? <IconCheck /> : <IconAlert />}{st}</span></td><td style={S.td}><input style={Object.assign({}, S.inp, { padding: "6px 10px" })} placeholder="Notes..." value={sn.notes || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[v] = Object.assign({}, sn, { notes: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} /></td></tr>; })}</tbody>
        </table>
      </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#A69E95" })}>Run fetch first.</div>}
    </div>}

    {subPage === "email" && <div>
      {emailBlocked && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconAlert /><span style={{ fontSize: 13, color: "#DC2626" }}><strong>{flagCount} flagged item{flagCount > 1 ? "s" : ""}</strong>{flags.s.length > 0 ? " (" + flags.s.length + " short-dating)" : ""}{flags.so.length > 0 ? " (" + flags.so.length + " sell-off)" : ""} must be removed from the PO before sending.</span></div>}
      {emailSent && <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconCheck /><span style={{ fontSize: 13, color: "#059669" }}><strong>Draft created!</strong></span></div>}
      <div style={S.card}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}><span style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, width: 50 }}>To:</span><span style={{ fontSize: 13, color: "#4A4541" }}>{cfg.emailTo}</span></div>
          <div style={{ display: "flex", gap: 8 }}><span style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, width: 50 }}>Subject:</span><span style={{ fontSize: 13, color: "#2C2825", fontWeight: 600 }}>{cfg.subjectFn(todayStr)}</span></div>
          <div style={{ borderTop: "1px solid #E8E4DE", paddingTop: 16, marginTop: 4, fontSize: 13, color: "#4A4541", lineHeight: 1.7 }}>Good morning,<br /><br />Attached are today&apos;s POs.<br /><br />Thanks in advance,<br /><br /><span style={{ color: "#8A8279", fontStyle: "italic" }}>[Vetcove Signature]</span></div>
        </div>
        <div style={{ marginTop: 20, borderTop: "1px solid #E8E4DE", paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, marginBottom: 10, textTransform: "uppercase" }}>Attachments ({uniqueVendors.length})</div>
          {uniqueVendors.map(function(v) { return <div key={v} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#FAFAF8", borderRadius: 8, marginBottom: 4 }}><IconDL /><span style={{ fontSize: 12, color: "#5C5651" }}>{v} PO Data - {whKey}.xlsx</span><div style={{ flex: 1 }} /><span style={{ fontSize: 11, color: "#A69E95" }}>{vendorGroups[v] ? vendorGroups[v].length : 0} rows</span></div>; })}
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 24px", opacity: (emailSent || emailLoading || emailBlocked) ? 0.5 : 1 })} onClick={async function() {
            if (emailBlocked) { toast("Remove all flagged items (short-dating / sell-off) before sending email", "error"); return; }
            if (!gmail || !gmail.token) { toast("Please connect your Gmail account first (bottom-left)", "error"); return; }
            setEmailLoading(true);
            try {
              var toLine = cfg.emailTo;
              var subject = cfg.subjectFn(todayStr);
              var htmlBody = "<p>Good morning,</p><p>Attached are today's POs.</p><p>Thanks in advance,</p>";
              var xlsCols = ["SKU", "Description", "Qty", "Vendor", "PO #", "Reorder", "Max", "Lead", "Min", "Avail", "Price", "Total"];
              var attachments = uniqueVendors.map(function(v) {
                var rows = (vendorGroups[v] || []).map(function(r) {
                  return [r.SKUNDC, r.Description, r.OrderQty, r.VendorName, r.OrderNbr, r.ReorderPoint, r.MaxQty, r.LeadTime, r.MinOrderQty, r.QtyAvailable, r.Price, r.TotalPrice];
                });
                return { filename: v + " PO Data - " + whKey + ".xlsx", columns: xlsCols, rows: rows };
              });
              var draftPayloads = [{ to: toLine, subject: subject, htmlBody: htmlBody, attachments: attachments }];
              var result = await postGmailDrafts(draftPayloads, gmail.token);
              if (result.failed > 0) throw new Error("Some drafts failed to create");
              setEmailSent(true); persist(data, true, runBy, runTime, shipNotes); toast(cfg.label + ": Draft created in Gmail");
            } catch (err) {
              toast("Gmail error: " + err.message, "error");
            } finally { setEmailLoading(false); }
          }} disabled={emailSent || emailLoading || emailBlocked || data.length === 0}><IconMail /> {emailBlocked ? flagCount + " Flagged Item" + (flagCount > 1 ? "s" : "") + " Present" : emailLoading ? "Creating..." : emailSent ? "Draft Created" : "Create Gmail Draft"}</Gate>
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
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#A69E95"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
    : icon === "image" ?
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#A69E95"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    : icon === "spreadsheet" ?
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#A69E95"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="9" x2="12" y2="21"/></svg>
    :
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={dragging ? accent : "#A69E95"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;

  return <div style={boxStyle} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={handleClick}>
    <input ref={inputRef} type="file" accept={accept || ""} multiple={!!multiple} onChange={handleInput} style={{ display: "none" }} />
    <div style={{ marginBottom: 6 }}>{iconSvg}</div>
    <div style={{ fontSize: 13, color: "#4A4541", fontWeight: 600 }}>{label || "Drop file here"}</div>
    {sublabel && <div style={{ fontSize: 11, color: "#A69E95", marginTop: 2 }}>{sublabel}</div>}
  </div>;
}

/* ═══════ CYCLE COUNTING TOOL ═══════ */
function CycleCountTool(props) {
  var toast = props.toast;
  var TOOL_COLOR = "#14B8A6";
  var _ndcText = useState(""), ndcText = _ndcText[0], setNdcText = _ndcText[1];
  var _vendorFile = useState(null), vendorFile = _vendorFile[0], setVendorFile = _vendorFile[1];
  var _vendorRows = useState(null), vendorRows = _vendorRows[0], setVendorRows = _vendorRows[1];
  var _csvWarehouses = useState([]), csvWarehouses = _csvWarehouses[0], setCsvWarehouses = _csvWarehouses[1];
  var _csvWhSelected = useState(""), csvWhSelected = _csvWhSelected[0], setCsvWhSelected = _csvWhSelected[1];
  var _stockFile = useState(null), stockFile = _stockFile[0], setStockFile = _stockFile[1];
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
      // Detect unique warehouse names from CSV
      var whSet = {};
      rows.forEach(function(r) { var w = (r.Warehouse || "").trim(); if (w) whSet[w] = 1; });
      var whList = Object.keys(whSet).sort();
      setCsvWarehouses(whList);
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
        var reportedQty = parseFloat(vendorRow["Reported Qty"]) || 0;
        var stockQty = parseFloat(vendorRow["Stock Qty"]) || 0;
        var quantity = reportedQty - stockQty;

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
    <p style={{ color: "#8A8279", fontSize: 14, marginBottom: 20 }}>Generate cycle count adjustment CSVs from Pharm Admin data and Stock Items.</p>

    <div style={S.card}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 14, color: "#4A4541", fontWeight: 600, marginBottom: 8 }}>1. Paste NDC List</div>
          <div style={{ fontSize: 12, color: "#8A8279", marginBottom: 6 }}>Copy the NDC column from your Google Sheet and paste below</div>
          <textarea value={ndcText} onChange={function(e) { setNdcText(e.target.value); }} placeholder={"68462-0128-01\n68462-0129-01\n43547-0336-10\n..."} rows={8} style={Object.assign({}, S.inp, { resize: "vertical", fontFamily: "monospace", fontSize: 12 })} />
          {ndcText.trim() && <p style={{ color: "#059669", fontSize: 12, marginTop: 6 }}>{"\u2713"} {ndcText.trim().split("\n").filter(function(l) { return l.trim(); }).length} NDCs pasted</p>}
        </div>
        <div>
          <div style={{ fontSize: 14, color: "#4A4541", fontWeight: 600, marginBottom: 8 }}>2. Warehouse Code</div>
          <div style={{ fontSize: 12, color: "#8A8279", marginBottom: 6 }}>Type the warehouse code for the output (e.g. TP-NY, TP-OH)</div>
          <input value={warehouse} onChange={function(e) { setWarehouse(e.target.value); }} placeholder="TP-NY" style={Object.assign({}, S.inp, { maxWidth: 200 })} />

          <div style={{ fontSize: 14, color: "#4A4541", fontWeight: 600, marginBottom: 8, marginTop: 20 }}>3. Vendor Inventory CSV</div>
          <div style={{ fontSize: 12, color: "#8A8279", marginBottom: 6 }}>Export from Pharm Admin (contains SKU, Manufacturer Number, Reported Qty, Stock Qty)</div>
          {vendorFile ? <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
              <span style={{ color: "#059669", fontSize: 13 }}>{"\u2713"} {vendorFile.name} — {vendorRows ? vendorRows.length.toLocaleString() + " rows" : "parsing..."}</span>
              <button onClick={function() { setVendorFile(null); setVendorRows(null); setCsvWarehouses([]); setCsvWhSelected(""); }} style={{ background: "transparent", border: "none", color: "#A69E95", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>{"\u00D7"}</button>
            </div>
          </div> : <DropZone accept=".csv" label="Vendor Inventory CSV" sublabel="Drop CSV or click to browse" icon="spreadsheet" color={TOOL_COLOR} onFiles={function(files) { handleVendorUpload(files[0]); }} />}
          {csvWarehouses.length > 1 && <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "#8A8279", marginBottom: 4 }}>Select warehouse from CSV:</div>
            <select value={csvWhSelected} onChange={function(e) { setCsvWhSelected(e.target.value); }} style={Object.assign({}, S.inp, { maxWidth: 280, cursor: "pointer" })}>
              <option value="">— Select —</option>
              {csvWarehouses.map(function(w) { return <option key={w} value={w}>{w}</option>; })}
            </select>
          </div>}
          {csvWarehouses.length === 1 && <p style={{ color: TOOL_COLOR, fontSize: 12, marginTop: 4 }}>Warehouse: {csvWhSelected}</p>}

          <div style={{ fontSize: 14, color: "#4A4541", fontWeight: 600, marginBottom: 8, marginTop: 20, display: "flex", alignItems: "center", gap: 6 }}>4. Stock Items XLSX <InfoTip text="Before uploading, make sure to delete all tabs except the one labeled 'Data' in the Excel file." /></div>
          <div style={{ fontSize: 12, color: "#8A8279", marginBottom: 6 }}>Contains Inventory ID and Sales Unit for UOM lookup</div>
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
        {results.length > 0 && <span style={{ fontSize: 12, color: "#8A8279" }}>{results.length} items</span>}
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
            <td style={Object.assign({}, S.td, { color: r.inventoryId.startsWith("GEN-") ? "#059669" : r.inventoryId.startsWith("UNV-") ? "#2563EB" : "#4A4541" })}>{r.inventoryId}</td>
            <td style={S.td}>{r.warehouse}</td>
            <td style={S.td}>{r.location}</td>
            <td style={Object.assign({}, S.td, { color: r.quantity < 0 ? "#DC2626" : "#4A4541" })}>{r.quantity}</td>
            <td style={S.td}>{r.uom}</td>
            <td style={Object.assign({}, S.td, { color: "#8A8279" })}>{r.ndc}</td>
            <td style={Object.assign({}, S.td, { color: "#8A8279" })}>{r.reportedQty}</td>
            <td style={Object.assign({}, S.td, { color: "#8A8279" })}>{r.stockQty}</td>
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
  var _screenshotUrls = useState([]), screenshotUrls = _screenshotUrls[0], setScreenshotUrls = _screenshotUrls[1];
  var _ocrLoading = useState(false), ocrLoading = _ocrLoading[0], setOcrLoading = _ocrLoading[1];
  var _ocrStatus = useState(""), ocrStatus = _ocrStatus[0], setOcrStatus = _ocrStatus[1];
  var _ocrRaw = useState(""), ocrRaw = _ocrRaw[0], setOcrRaw = _ocrRaw[1];
  var _showRawOcr = useState(false), showRawOcr = _showRawOcr[0], setShowRawOcr = _showRawOcr[1];
  var _ocrFoundNdcs = useState(null), ocrFoundNdcs = _ocrFoundNdcs[0], setOcrFoundNdcs = _ocrFoundNdcs[1];
  var _loading = useState(false), loading = _loading[0], setLoading = _loading[1];
  var _results = useState([]), results = _results[0], setResults = _results[1];
  var _screenshotQtys = useState({}), screenshotQtys = _screenshotQtys[0], setScreenshotQtys = _screenshotQtys[1];
  var _editedPrices = useState({}), editedPrices = _editedPrices[0], setEditedPrices = _editedPrices[1];
  var _mckWarnings = useState([]), mckWarnings = _mckWarnings[0], setMckWarnings = _mckWarnings[1];
  var _error = useState(null), error = _error[0], setError = _error[1];
  var _ndcMap = useState(null), ndcMap = _ndcMap[0], setNdcMap = _ndcMap[1];
  var _ndcLoading = useState(false), ndcLoading = _ndcLoading[0], setNdcLoading = _ndcLoading[1];

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

  function preprocessImageForOcr(imgUrl) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var scale = 2; // 2x is optimal based on testing
        var canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        var ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var data = imageData.data;
        for (var i = 0; i < data.length; i += 4) {
          var gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          var bw = gray < 128 ? 0 : 255; // threshold 128 — tested to find all 16 NDCs
          data[i] = bw; data[i + 1] = bw; data[i + 2] = bw; data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = imgUrl;
    });
  }

  async function loadTesseract() {
    if (typeof window !== "undefined" && window.Tesseract) return window.Tesseract;
    return new Promise(function(resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js";
      script.onload = function() { resolve(window.Tesseract); };
      script.onerror = function() { reject(new Error("Failed to load Tesseract.js")); };
      document.head.appendChild(script);
    });
  }

  function extractNdcsFromOcrText(text) {
    var ndcs = [];
    var seen = {};
    // Find 11-digit NDCs (no dashes — McKesson portal format)
    var re11 = /\b(\d{11})\b/g;
    var m;
    while ((m = re11.exec(text)) !== null) {
      var n = m[1];
      if (!seen[n]) { seen[n] = true; ndcs.push(n); }
    }
    // Also find dashed NDCs
    var reDash = /\b(\d{4,5}-\d{3,4}-\d{1,2})\b/g;
    while ((m = reDash.exec(text)) !== null) {
      var norm = m[1].replace(/-/g, "");
      if (!seen[norm]) { seen[norm] = true; ndcs.push(norm); }
    }
    return ndcs;
  }

  async function handleScreenshotUpload(files) {
    if (files.length === 0) return;
    var urls = files.map(function(f) { return URL.createObjectURL(f); });
    setScreenshotUrls(urls);
    setOcrLoading(true);
    setOcrStatus("Preprocessing images...");
    setOcrRaw("");
    setMckParsed(null);
    try {
      var Tesseract = await loadTesseract();
      var worker = await Tesseract.createWorker({
        logger: function(m) {
          if (m.status === "recognizing text") setOcrStatus("Reading text... " + Math.round((m.progress || 0) * 100) + "%");
          if (m.status === "loading language traineddata") setOcrStatus("Loading language data...");
        }
      });
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      var allOcrText = "";
      var allNdcs = {};
      for (var fi = 0; fi < urls.length; fi++) {
        setOcrStatus("Processing screenshot " + (fi + 1) + " of " + urls.length + "...");
        var processedUrl = await preprocessImageForOcr(urls[fi]);
        var result = await worker.recognize(processedUrl);
        var ocrText = result.data.text;
        allOcrText += (fi > 0 ? "\n--- Screenshot " + (fi + 1) + " ---\n" : "") + ocrText;
        var ndcs = extractNdcsFromOcrText(ocrText);
        ndcs.forEach(function(n) { allNdcs[n] = true; });
      }
      await worker.terminate();
      setOcrRaw(allOcrText);
      var ocrNdcList = Object.keys(allNdcs);
      setOcrFoundNdcs(ocrNdcList);
      // Merge with any manual NDCs already in paste box
      var manualNdcs = extractNdcsFromOcrText(mckPaste);
      manualNdcs.forEach(function(n) { allNdcs[n] = true; });
      var combined = Object.keys(allNdcs);
      if (combined.length > 0) {
        var items = combined.map(function(ndc) { return { ndc: ndc, description: "", qty: null, mckItemNum: "" }; });
        setMckParsed(items);
        toast("OCR found " + ocrNdcList.length + " NDCs from " + urls.length + " screenshot" + (urls.length > 1 ? "s" : "") + (manualNdcs.length > 0 ? " + " + manualNdcs.length + " manual" : ""));
      } else {
        setMckParsed(null);
        toast("OCR could not find NDCs. You can also paste them manually below.", "error");
      }
    } catch (err) {
      toast("OCR error: " + err.message, "error");
    } finally {
      setOcrLoading(false);
      setOcrStatus("");
    }
  }

  function handleMckManualPaste(e) {
    var text = e.target.value;
    setMckPaste(text);
    // Merge manual NDCs with any OCR-found NDCs
    var manualNdcs = extractNdcsFromOcrText(text);
    // Get existing OCR NDCs (stored separately)
    var ocrNdcList = (ocrFoundNdcs || []).slice();
    // Combine and deduplicate
    var allNdcs = {};
    ocrNdcList.forEach(function(n) { allNdcs[n] = true; });
    manualNdcs.forEach(function(n) { allNdcs[n] = true; });
    var combined = Object.keys(allNdcs);
    if (combined.length > 0) {
      setMckParsed(combined.map(function(ndc) { return { ndc: ndc, description: "", qty: null, mckItemNum: "" }; }));
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
      }

      setResults(matched);
      setMckWarnings(warnings);
      var foundCount = matched.filter(function(r) { return r.ndcFound; }).length;
      toast("Validated " + matched.length + " items: " + foundCount + " matched in OData, " + (matched.length - foundCount) + " not found");
    } catch (err) {
      setError(err.message);
      toast("Validation failed: " + err.message, "error");
    } finally { setLoading(false); }
  }

  function downloadCSV() {
    var header = "Status,Inventory ID,Warehouse,Description (Acumatica),UOM,Drug Name (PO),Alternate ID,Vendor,Order Qty.,Unit Cost,Ext. Cost,PO#,Source File\r\n";
    var lines = results.map(function(r) {
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
    a.href = url; a.download = "po_ndc_validation_" + new Date().toISOString().slice(0, 10) + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setPdfs([]); setMckPaste(""); setMckParsed(null); setScreenshotUrls([]); setOcrRaw(""); setShowRawOcr(false); setOcrFoundNdcs(null); setScreenshotQtys({}); setEditedPrices({}); setResults([]); setMckWarnings([]); setError(null);
  }

  var S = useMemo(function() { return makeStyles(TOOL_COLOR); }, []);
  var foundCount = results.filter(function(r) { return r.ndcFound; }).length;
  var notFoundCount = results.length - foundCount;
  var qtyMismatchCount = results.filter(function(r) { return screenshotQtys[r.ndc] != null && parseInt(screenshotQtys[r.ndc]) !== r.qty; }).length;

  return (
    <div>
      <p style={{ color: "#8A8279", fontSize: 13, marginBottom: 20 }}>Upload vendor PO PDFs to extract NDCs, then validate against Acumatica <strong>Generic Current NDCs</strong> OData to find GEN- Inventory IDs.</p>

      <div style={S.card}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, marginBottom: 8 }}>Vendor Type</div>
          <div style={{ display: "flex", gap: 10 }}>
            {[["other", "Keysource / Anda / Bloodworth"], ["mckesson", "McKesson"]].map(function(v) {
              return <button key={v[0]} onClick={function() { setVendor(v[0]); reset(); }}
                style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid " + (vendor === v[0] ? TOOL_COLOR : "#E8E4DE"), background: vendor === v[0] ? TOOL_COLOR + "20" : "transparent", color: vendor === v[0] ? TOOL_COLOR : "#8A8279", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{v[1]}</button>;
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: vendor === "mckesson" ? "1fr 1fr" : "1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, marginBottom: 6 }}>PO PDF(s)</div>
            {pdfs.length > 0 ? <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
                <span style={{ color: "#059669", fontSize: 12 }}>{"\u2713"} {pdfs.length} PDF{pdfs.length > 1 ? "s" : ""}: {pdfs.map(function(p) { return p.name; }).join(", ")}</span>
                <button onClick={function() { setPdfs([]); }} style={{ background: "transparent", border: "none", color: "#A69E95", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>{"\u00D7"}</button>
              </div>
            </div> : <DropZone accept=".pdf" multiple label="PO PDF(s)" sublabel="Drop PDFs or click to browse" icon="pdf" color={TOOL_COLOR} onFiles={handlePdfChange} />}
          </div>
          {vendor === "mckesson" && <div>
            <div style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, marginBottom: 6 }}>McKesson Portal Screenshot(s)</div>
            {screenshotUrls.length > 0 && !ocrLoading ? <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 10 }}>
                <span style={{ color: "#059669", fontSize: 12 }}>{"\u2713"} {screenshotUrls.length} screenshot{screenshotUrls.length > 1 ? "s" : ""}{mckParsed ? " — " + mckParsed.length + " NDCs found" : ""}</span>
                <button onClick={function() { setScreenshotUrls([]); setMckParsed(null); setOcrRaw(""); }} style={{ background: "transparent", border: "none", color: "#A69E95", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>{"\u00D7"}</button>
              </div>
            </div> : <DropZone accept="image/*" multiple label="McKesson Screenshots" sublabel="Drop images or click to browse" icon="image" color={TOOL_COLOR} disabled={ocrLoading} onFiles={handleScreenshotUpload} />}
            {ocrLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}><Spinner color={TOOL_COLOR} size={14} /><span style={{ fontSize: 12, color: TOOL_COLOR }}>{ocrStatus || "Processing..."}</span></div>}
            {screenshotUrls.length > 0 && !ocrLoading && !mckParsed && <p style={{ color: "#D97706", fontSize: 11, marginTop: 6 }}>{"\u26A0"} OCR could not find NDCs — type them manually below</p>}
            <div style={{ marginTop: 10, fontSize: 11, color: "#A69E95" }}>Add any missing NDCs below (one per line — will be merged with OCR results):</div>
            <textarea value={mckPaste} onChange={handleMckManualPaste} placeholder={"67877019710\n29300041001\n53746075101\n..."} rows={3} style={Object.assign({}, S.inp, { resize: "vertical", fontFamily: "monospace", fontSize: 12, marginTop: 4 })} />
          </div>}
        </div>

        {vendor === "mckesson" && mckParsed && mckParsed.length > 0 && <div style={{ marginTop: 16, background: "#FAFAF8", border: "1px solid #E8E4DE", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: "#8A8279", fontWeight: 600, textTransform: "uppercase" }}>Portal NDCs ({mckParsed.length})</div>
            {ocrRaw && <button onClick={function() { setShowRawOcr(!showRawOcr); }} style={{ background: "transparent", border: "1px solid #E8E4DE", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#8A8279", cursor: "pointer" }}>{showRawOcr ? "Hide" : "Show"} Raw OCR</button>}
          </div>
          <div style={{ maxHeight: 80, overflow: "auto", fontSize: 13, fontFamily: "monospace", color: "#8A8279" }}>
            {mckParsed.map(function(pi, idx) { return <div key={idx}>{pi.ndc}</div>; })}
          </div>
          {showRawOcr && <div style={{ maxHeight: 200, overflow: "auto", fontSize: 11, fontFamily: "monospace", color: "#A69E95", background: "#F0EDE8", borderRadius: 6, padding: 8, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{ocrRaw}</div>}
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
        </div>
      </div>

      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>Error: {error}</div>}

      {screenshotUrls.length > 0 && vendor === "mckesson" && <div style={S.card}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#2C2825", marginBottom: 12 }}>McKesson Portal Screenshot{screenshotUrls.length > 1 ? "s (" + screenshotUrls.length + ")" : ""}</div>
        {screenshotUrls.map(function(url, idx) { return <div key={idx} style={{ border: "1px solid #E8E4DE", borderRadius: 8, overflow: "hidden", maxHeight: 400, overflowY: "auto", marginBottom: screenshotUrls.length > 1 ? 12 : 0 }}>
          {screenshotUrls.length > 1 && <div style={{ padding: "6px 12px", background: "#F5F3EF", fontSize: 12, color: "#8A8279" }}>Screenshot {idx + 1}</div>}
          <img src={url} alt={"McKesson screenshot " + (idx + 1)} style={{ width: "100%", display: "block" }} />
        </div>; })}
      </div>}

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
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {(function() { var pos = {}; results.forEach(function(r) { if (r.poNumber) pos[r.poNumber] = 1; }); var poList = Object.keys(pos); return poList.length > 0 ? <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#8A8279", textTransform: "uppercase", fontWeight: 600 }}>PO #</div><div style={{ fontSize: 20, fontWeight: 700, color: TOOL_COLOR, marginTop: 4 }}>{poList.join(", ")}</div></div> : null; })()}
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#8A8279", textTransform: "uppercase", fontWeight: 600 }}>Total Items</div><div style={{ fontSize: 24, fontWeight: 700, color: "#2C2825", marginTop: 4 }}>{results.length}</div></div>
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#8A8279", textTransform: "uppercase", fontWeight: 600 }}>In OData</div><div style={{ fontSize: 24, fontWeight: 700, color: "#059669", marginTop: 4 }}>{foundCount}</div></div>
          <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#8A8279", textTransform: "uppercase", fontWeight: 600 }}>Not in OData</div><div style={{ fontSize: 24, fontWeight: 700, color: notFoundCount > 0 ? "#DC2626" : "#059669", marginTop: 4 }}>{notFoundCount}</div></div>
          {vendor === "mckesson" && <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#8A8279", textTransform: "uppercase", fontWeight: 600 }}>Qty Edited</div><div style={{ fontSize: 24, fontWeight: 700, color: qtyMismatchCount > 0 ? "#D97706" : "#059669", marginTop: 4 }}>{qtyMismatchCount}</div></div>}
          {mckWarnings.length > 0 && <div style={Object.assign({}, S.card, { flex: 1, padding: "16px 20px", marginBottom: 0 })}><div style={{ fontSize: 11, color: "#8A8279", textTransform: "uppercase", fontWeight: 600 }}>MCK Warnings</div><div style={{ fontSize: 24, fontWeight: 700, color: "#D97706", marginTop: 4 }}>{mckWarnings.length}</div></div>}
        </div>

        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #E8E4DE" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#2C2825" }}>NDC Validation Results</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={reset} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}><IconTrash /> Clear</button>
              <button onClick={downloadCSV} style={Object.assign({}, S.btn(), { padding: "6px 14px", fontSize: 12 })}><IconCSV /> Download CSV</button>
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
            <tbody>{results.map(function(r, i) {
              var editedQty = screenshotQtys[r.ndc] != null ? parseInt(screenshotQtys[r.ndc]) : r.qty;
              var qtyChanged = screenshotQtys[r.ndc] != null && parseInt(screenshotQtys[r.ndc]) !== r.qty;
              var editedPrice = editedPrices[r.ndc] != null ? parseFloat(editedPrices[r.ndc]) : r.unitPrice;
              var priceChanged = editedPrices[r.ndc] != null && parseFloat(editedPrices[r.ndc]) !== r.unitPrice;
              var extCost = (editedQty && editedPrice) ? (editedQty * editedPrice) : r.totalPrice;
              return <tr key={i} style={{ background: (qtyChanged || priceChanged) ? "rgba(245,158,11,0.06)" : (r.ndcFound ? "transparent" : "rgba(239,68,68,0.04)") }}>
                <td style={S.td}><span style={S.badge(r.ndcFound ? "success" : "danger")}>{r.ndcFound ? <><IconCheck /> Match</> : <><IconAlert /> Missing</>}</span></td>
                <td style={S.td}>{r.ndc}</td>
                <td style={Object.assign({}, S.td, { color: r.inventoryId ? "#059669" : "#A69E95" })}>{r.inventoryId || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { maxWidth: 220, wordBreak: "break-word" })}>{r.acumaticaDesc || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { color: r.uom ? "#06B6D4" : "#A69E95" })}>{r.uom || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { color: "#8A8279", maxWidth: 200, wordBreak: "break-word" })}>{r.drugName || "\u2014"}</td>
                <td style={S.td}>{r.vendorSource || "\u2014"}</td>
                <td style={Object.assign({}, S.td, { textAlign: "center" })}><input style={Object.assign({}, S.inp, { width: 70, padding: "6px 8px", textAlign: "center", color: qtyChanged ? "#D97706" : "#4A4541", background: qtyChanged ? "rgba(245,158,11,0.1)" : "#FAFAF8" })} type="number" value={screenshotQtys[r.ndc] != null ? screenshotQtys[r.ndc] : (r.qty || "")} onChange={function(e) { var updated = Object.assign({}, screenshotQtys); updated[r.ndc] = e.target.value; setScreenshotQtys(updated); }} /></td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}><input style={Object.assign({}, S.inp, { width: 90, padding: "6px 8px", textAlign: "right", color: priceChanged ? "#D97706" : "#059669", background: priceChanged ? "rgba(245,158,11,0.1)" : "#FAFAF8" })} type="number" step="0.01" value={editedPrices[r.ndc] != null ? editedPrices[r.ndc] : (r.unitPrice || "")} onChange={function(e) { var updated = Object.assign({}, editedPrices); updated[r.ndc] = e.target.value; setEditedPrices(updated); }} /></td>
                <td style={Object.assign({}, S.td, { textAlign: "right" })}>{extCost ? "$" + extCost.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "\u2014"}</td>
                {vendor === "mckesson" && <td style={S.td}>{r.vendorItemNum || "\u2014"}</td>}
                <td style={Object.assign({}, S.td, { color: "#A69E95" })}>{(r.sourceFile || "").split("/").pop()}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

/* ═══════ MAIN HUB ═══════ */
export default function Hub() {
  var _p = useState("TP-NY"), page = _p[0], setPage = _p[1];
  var _c = useState({ username: "", password: "" }), cred = _c[0], setCred = _c[1];
  var _ok = useState(false), ok = _ok[0], setOk = _ok[1];
  var _sl = useState(false), showLogin = _sl[0], setShowLogin = _sl[1];
  var _t = useState(null), toast = _t[0], setToast = _t[1];
  var _cl = useState(true), credLoading = _cl[0], setCredLoading = _cl[1];
  var _gm = useState(null), gmail = _gm[0], setGmail = _gm[1];
  var _sr = useState(function() { var saved = sGet("shipping-rules-v2"); return saved || Object.assign({}, DEFAULT_SHIP_RULES); }), shipRules = _sr[0], setShipRules = _sr[1];
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
  var login = useCallback(async function() { if (cred.username && cred.password) { sSet("user-credentials", cred); setOk(true); setShowLogin(false); showToast("Credentials saved"); } }, [cred, showToast]);
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

  if (credLoading) return <div style={{ fontFamily: "sans-serif", background: "#FAFAF8", color: "#4A4541", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner color="#3B82F6" size={24} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  if (!ok) return (
    <div style={{ fontFamily: "'Varela Round',sans-serif", background: "#FAFAF8", color: "#4A4541", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Varela+Round&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.12)}input:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)}`}</style>
      <div style={{ background: "#FFFFFF", border: "1px solid #E8E4DE", borderRadius: 16, padding: 40, width: 420, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}><IconKey /></div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#2C2825", margin: "0 0 4px" }}>Inventory Hub</h1>
        <p style={{ fontSize: 11, color: "#8A8279", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", margin: "0 0 32px" }}>Vetcove Tools</p>
        <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, display: "block", marginBottom: 6 }}>Acumatica Username</label><input style={{ background: "#FAFAF8", border: "1px solid #E8E4DE", borderRadius: 8, padding: "10px 14px", color: "#4A4541", fontSize: 14, outline: "none", width: "100%" }} value={cred.username} onChange={function(e) { setCred({ username: e.target.value, password: cred.password }); }} placeholder="your.username" /></div>
          <div><label style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, display: "block", marginBottom: 6 }}>Acumatica Password</label><input style={{ background: "#FAFAF8", border: "1px solid #E8E4DE", borderRadius: 8, padding: "10px 14px", color: "#4A4541", fontSize: 14, outline: "none", width: "100%" }} type="password" value={cred.password} onChange={function(e) { setCred({ username: cred.username, password: e.target.value }); }} placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} onKeyDown={function(e) { if (e.key === "Enter") login(); }} /></div>
          <button onClick={login} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "12px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8 }}><IconKey /> Sign In</button>
        </div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#FFFFFF", color: toast.t === "success" || toast.t === "error" ? "#fff" : "#2C2825", border: "1px solid " + (toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#E8E4DE"), boxShadow: "0 4px 20px rgba(44,40,37,0.12)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );

  var isWH = page in WH;
  var activeColor = isWH ? WH[page].color : page === "short-dating" ? "#E879F9" : page === "backorder" ? "#F97316" : page === "po-import" ? "#06B6D4" : page === "cycle-count" ? "#14B8A6" : "#3B82F6";
  var activeLabel = isWH ? WH[page].full : page === "short-dating" ? "Short-Dating Tracker" : page === "backorder" ? "Backorder Tracker" : page === "po-import" ? "PO NDC Validator" : page === "cycle-count" ? "Cycle Counting" : showLogin ? "Login" : "Shipping Rules";

  function SideLink(p) {
    var active = page === p.id && !showLogin;
    return <div onClick={function() { setPage(p.id); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", fontSize: 14, cursor: "pointer", transition: "all 0.15s", fontWeight: active ? 600 : 400, color: active ? "#2C2825" : "#8A8279", background: active ? p.color + "15" : "transparent", borderRight: active ? "2px solid " + p.color : "2px solid transparent" }}><Dot color={p.color} />{p.label}</div>;
  }

  return (
    <div style={{ fontFamily: "'Varela Round',sans-serif", background: "#FAFAF8", color: "#4A4541", minHeight: "100vh", display: "flex" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Varela+Round&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#FAFAF8}::-webkit-scrollbar-thumb{background:#E8E4DE;border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.12)}input:focus,select:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)}tr:hover td{background:rgba(59,130,246,0.04)}`}</style>

      <div style={{ width: 240, background: "#FFFFFF", borderRight: "1px solid #E8E4DE", display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0 }}>
        <div style={{ padding: "0 24px 24px", borderBottom: "1px solid #E8E4DE", marginBottom: 12 }}>
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px", color: "#2C2825", margin: 0 }}>Inventory Hub</p>
          <p style={{ fontSize: 11, color: "#8A8279", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 4 }}>Vetcove Tools</p>
        </div>
        <div style={{ padding: "0 12px", marginBottom: 4 }}><div style={{ fontSize: 10, fontWeight: 600, color: "#A69E95", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>PO Tools</div></div>
        {Object.entries(WH).map(function(e) { return <SideLink key={e[0]} id={e[0]} label={e[1].full} color={e[1].color} />; })}
        <div style={{ padding: "12px 12px 4px", marginTop: 4, borderTop: "1px solid #E8E4DE" }}><div style={{ fontSize: 10, fontWeight: 600, color: "#A69E95", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>Generic PO Tools</div></div>
        <SideLink id="po-import" label="PO NDC Validator" color="#06B6D4" />
        <SideLink id="cycle-count" label="Cycle Counting" color="#14B8A6" />
        <div style={{ padding: "12px 12px 4px", marginTop: 4, borderTop: "1px solid #E8E4DE" }}><div style={{ fontSize: 10, fontWeight: 600, color: "#A69E95", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>Inventory Tools</div></div>
        <SideLink id="short-dating" label="Short-Dating" color="#E879F9" />
        <SideLink id="backorder" label="Backorders" color="#F97316" />
        <div style={{ padding: "12px 12px 4px", marginTop: 4, borderTop: "1px solid #E8E4DE" }}><div style={{ fontSize: 10, fontWeight: 600, color: "#A69E95", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>Settings</div></div>
        <div onClick={function() { setPage("rules"); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", fontSize: 14, cursor: "pointer", fontWeight: page === "rules" && !showLogin ? 600 : 400, color: page === "rules" && !showLogin ? "#2C2825" : "#8A8279", background: page === "rules" && !showLogin ? "rgba(59,130,246,0.1)" : "transparent", borderRight: page === "rules" && !showLogin ? "2px solid #3B82F6" : "2px solid transparent" }}><IconTruck /> Shipping Rules</div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: "0 16px" }}>
          <div style={{ padding: "12px 16px", background: ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid " + (ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)") }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Dot color={ok ? "#059669" : "#DC2626"} /><span style={{ fontSize: 12, color: ok ? "#059669" : "#DC2626", fontWeight: 500 }}>{ok ? "Connected" : "Not Connected"}</span></div>
            {ok && cred.username && <div style={{ fontSize: 11, color: "#8A8279", marginTop: 4, paddingLeft: 16 }}>{cred.username}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={function() { setShowLogin(true); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, background: "transparent", color: "#8A8279", border: "1px solid #E8E4DE", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><IconKey /> {ok ? "Update" : "Login"}</button>
              {ok && <button onClick={logout} style={{ background: "transparent", color: "#8A8279", border: "1px solid #E8E4DE", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Logout</button>}
            </div>
          </div>
          <div style={{ padding: "12px 16px", marginTop: 8, background: gmail ? "rgba(59,130,246,0.08)" : "rgba(100,116,139,0.08)", borderRadius: 10, border: "1px solid " + (gmail ? "rgba(59,130,246,0.2)" : "rgba(100,116,139,0.2)") }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><IconGmail /><span style={{ fontSize: 12, color: gmail ? "#2563EB" : "#8A8279", fontWeight: 500 }}>{gmail ? "Gmail Connected" : "Gmail Not Connected"}</span></div>
            {gmail && gmail.email && <div style={{ fontSize: 11, color: "#8A8279", marginTop: 4, paddingLeft: 22 }}>{gmail.email}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={connectGmail} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, background: "transparent", color: "#8A8279", border: "1px solid #E8E4DE", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><IconGmail /> {gmail ? "Reconnect" : "Connect"}</button>
              {gmail && <button onClick={disconnectGmail} style={{ background: "transparent", color: "#8A8279", border: "1px solid #E8E4DE", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Disconnect</button>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        <div style={{ padding: "16px 32px", borderBottom: "1px solid #E8E4DE", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F5F3EF" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{!showLogin && <Dot color={activeColor} />}<span style={{ fontSize: 18, fontWeight: 600, color: "#2C2825" }}>{showLogin ? "Acumatica Login" : activeLabel}</span>{isWH && !showLogin && <span style={{ fontSize: 12, background: activeColor + "20", color: activeColor, padding: "3px 10px", borderRadius: 6, fontWeight: 600 }}>{page}</span>}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{!ok && !showLogin && <span style={{ fontSize: 12, color: "#DC2626", display: "flex", alignItems: "center", gap: 4 }}><IconLock /> View only</span>}<span style={{ fontSize: 12, color: "#8A8279" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></div>
        </div>
        <div style={{ padding: 32, flex: 1 }}>
          {showLogin && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}><div style={{ background: "#FFFFFF", border: "1px solid #E8E4DE", borderRadius: 12, padding: 32, width: 400, textAlign: "center" }}><div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><IconKey /></div><h2 style={{ fontSize: 20, fontWeight: 700, color: "#2C2825", margin: "0 0 4px" }}>Acumatica Login</h2><p style={{ color: "#A69E95", fontSize: 11, margin: "0 0 24px" }}>Shared across all tools</p><div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}><div><label style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, display: "block", marginBottom: 4 }}>Username</label><input style={{ background: "#FAFAF8", border: "1px solid #E8E4DE", borderRadius: 8, padding: "8px 12px", color: "#4A4541", fontSize: 13, outline: "none", width: "100%" }} value={cred.username} onChange={function(e) { setCred({ username: e.target.value, password: cred.password }); }} placeholder="your.username" /></div><div><label style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, display: "block", marginBottom: 4 }}>Password</label><input style={{ background: "#FAFAF8", border: "1px solid #E8E4DE", borderRadius: 8, padding: "8px 12px", color: "#4A4541", fontSize: 13, outline: "none", width: "100%" }} type="password" value={cred.password} onChange={function(e) { setCred({ username: cred.username, password: e.target.value }); }} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" /></div><button onClick={login} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>Connect</button></div></div></div>}

          {page === "rules" && !showLogin && <div>
            <p style={{ color: "#8A8279", fontSize: 13, marginBottom: 16 }}>Vendor shipping rules for PO warehouses. Rules are saved to your browser.</p>
            <div style={{ background: "#FFFFFF", border: "1px solid #E8E4DE", borderRadius: 12, overflow: "auto", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead><tr>
                  <th style={{ padding: "12px 14px", textAlign: "left", background: "#F5F3EF", color: "#9A928A", fontWeight: 600, fontSize: 13, textTransform: "uppercase", borderBottom: "2px solid #E8E4DE" }}>Vendor</th>
                  <th style={{ padding: "12px 14px", textAlign: "left", background: "#F5F3EF", color: "#9A928A", fontWeight: 600, fontSize: 13, textTransform: "uppercase", borderBottom: "2px solid #E8E4DE" }}>Rule</th>
                  <th style={{ padding: "12px 14px", textAlign: "center", background: "#F5F3EF", color: "#9A928A", fontWeight: 600, fontSize: 13, textTransform: "uppercase", borderBottom: "2px solid #E8E4DE", width: 60 }}></th>
                </tr></thead>
                <tbody>{Object.entries(shipRules).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) {
                  return <tr key={e[0]}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F0EDE8", color: "#4A4541", fontSize: 14 }}>{e[0]}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F0EDE8" }}>
                      <input style={{ background: "#F8F6F3", border: "1px solid #E8E4DE", borderRadius: 8, padding: "8px 12px", color: "#4A4541", fontSize: 13, outline: "none", width: "100%", fontFamily: "'Varela Round', sans-serif" }} value={e[1]} onChange={function(ev) { var updated = Object.assign({}, shipRules); updated[e[0]] = ev.target.value; updateShipRules(updated); }} />
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #F0EDE8", textAlign: "center" }}>
                      <button onClick={function() { var updated = Object.assign({}, shipRules); delete updated[e[0]]; updateShipRules(updated); showToast("Removed " + e[0]); }} style={{ background: "transparent", border: "1px solid #E8E4DE", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#DC2626", cursor: "pointer" }}>{"\u2715"}</button>
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div style={{ background: "#FFFFFF", border: "1px solid #E8E4DE", borderRadius: 12, padding: 20, display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, display: "block", marginBottom: 4 }}>Vendor Name</label>
                <input id="new-vendor-name" style={{ background: "#F8F6F3", border: "1px solid #E8E4DE", borderRadius: 8, padding: "8px 12px", color: "#4A4541", fontSize: 14, outline: "none", width: "100%", fontFamily: "'Varela Round', sans-serif" }} placeholder="e.g. Zoetis US LLC" />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 12, color: "#8A8279", fontWeight: 500, display: "block", marginBottom: 4 }}>Rule</label>
                <input id="new-vendor-rule" style={{ background: "#F8F6F3", border: "1px solid #E8E4DE", borderRadius: 8, padding: "8px 12px", color: "#4A4541", fontSize: 14, outline: "none", width: "100%", fontFamily: "'Varela Round', sans-serif" }} placeholder="e.g. min:5000; message:Free Shipping; else:Not Free Shipping" />
              </div>
              <button onClick={function() { var nameEl = document.getElementById("new-vendor-name"); var ruleEl = document.getElementById("new-vendor-rule"); var name = (nameEl.value || "").trim(); var rule = (ruleEl.value || "").trim(); if (!name) { showToast("Enter a vendor name", "error"); return; } if (!rule) { showToast("Enter a rule", "error"); return; } var updated = Object.assign({}, shipRules); updated[name] = rule; updateShipRules(updated); nameEl.value = ""; ruleEl.value = ""; showToast("Added " + name); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#3B82F6", color: "#fff", flexShrink: 0 }}>+ Add</button>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <button onClick={function() { updateShipRules(Object.assign({}, DEFAULT_SHIP_RULES)); showToast("Reset to defaults"); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #E8E4DE", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "#8A8279" }}>Reset to Defaults</button>
              <span style={{ fontSize: 12, color: "#B5AEA5", alignSelf: "center" }}>{Object.keys(shipRules).length} vendors</span>
            </div>
          </div>}

          {!showLogin && Object.entries(WH).map(function(e) { return <div key={e[0]} style={{ display: page === e[0] ? "block" : "none" }}><WHT whKey={e[0]} cfg={e[1]} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} shipRules={shipRules} /></div>; })}
          {!showLogin && page === "short-dating" && <TrackerTool toolKey="short-dating" toolLabel="Short-Dating Tracker" toolColor="#E879F9" demoData={SD_DEMO} columns={sdColumns} emailConfig={sdEmail} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} />}
          {!showLogin && page === "backorder" && <TrackerTool toolKey="backorder" toolLabel="Backorder Tracker" toolColor="#F97316" demoData={BKO_DEMO} columns={bkoColumns} emailConfig={bkoEmail} skipVendors={BKO_SKIP} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} />}
          {!showLogin && page === "po-import" && <POImportTool toast={showToast} cred={cred} ok={ok} lp={promptLogin} />}
          {!showLogin && page === "cycle-count" && <CycleCountTool toast={showToast} />}
        </div>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#FFFFFF", color: toast.t === "success" || toast.t === "error" ? "#fff" : "#2C2825", border: "1px solid " + (toast.t === "success" ? "#059669" : toast.t === "error" ? "#DC2626" : "#E8E4DE"), boxShadow: "0 4px 20px rgba(44,40,37,0.12)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );
}
