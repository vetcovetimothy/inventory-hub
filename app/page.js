"use client";
import { useState, useMemo, useCallback, useEffect } from "react";

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
const SHIP_RULES = {
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
const BKO_SKIP = ["Bloodworth Wholesale Drugs", "Elanco US Inc."];
const WH = {
  "TP-NY": { label: "Brooklyn", full: "Brooklyn, NY", color: "#3B82F6", emailTo: "nigel.white@fuzehealth.com, anna.wilson@fuzehealth.com, trudie.selby@fuzehealth.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Brooklyn " + d; } },
  "TP-OH": { label: "Ohio", full: "Ohio", color: "#10B981", emailTo: "nigel.white@fuzehealth.com, anna.wilson@fuzehealth.com, trudie.selby@fuzehealth.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Ohio " + d; } },
  "TP-CA": { label: "Hayward", full: "Hayward, CA", color: "#F59E0B", emailTo: "nigel.white@fuzehealth.com, anna.wilson@fuzehealth.com, trudie.selby@fuzehealth.com, hd-purchaseorders@vetcove.com", subjectFn: function(d) { return "Hayward " + d; } },
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
    { SKUNDC: "DECHRA-001", Description: "Vetoryl Capsules: [30mg] 30ct", OrderQty: 10, VendorName: "Merck Animal Health", OrderNbr: "PO007175", Warehouse: "TP-NY", ReorderPoint: 4, MaxQty: 12, LeadTime: 6, MinOrderQty: 5, QtyAvailable: 1, Price: 89.00, MovementClass: "short-dating" },
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
function Dot({ color }) { return <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />; }
function Spinner({ color, size }) { return <span style={{ width: size || 14, height: size || 14, border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid " + (color || "#fff"), borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />; }

/* ═══════ STYLES ═══════ */
function makeStyles(accent) {
  return {
    card: { background: "#111520", border: "1px solid #1E2433", borderRadius: 12, padding: 24, marginBottom: 20 },
    statCard: { background: "#111520", border: "1px solid #1E2433", borderRadius: 12, padding: "20px 24px", flex: 1, minWidth: 160, position: "relative", overflow: "hidden" },
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

function Gate({ ok, prompt, children, style, onClick, disabled }) {
  if (ok) return <button style={style} onClick={onClick} disabled={disabled}>{children}</button>;
  return <button style={Object.assign({}, style, { opacity: 0.6 })} onClick={prompt}><IconLock /> Login Required</button>;
}

function CopyCell({ text, toast, color, accentColor }) {
  return (
    <div title={text} onClick={function() { navigator.clipboard.writeText(text); toast("Copied"); }}
      style={{ cursor: "pointer", padding: "2px 6px", borderRadius: 4, userSelect: "all", wordBreak: "break-word", lineHeight: 1.4, color: color || "#CBD5E1" }}>
      {text}
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

  if (initLoading) return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#64748B" })}><Spinner color={toolColor} size={20} /></div>;

  var ToolIcon = toolKey === "backorder" ? IconBox : IconClock;
  var dataLabel = toolKey === "backorder" ? "Backorder Data" : "Short Data";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "#0B0E14", borderRadius: 10, padding: 3 }}>
          <button onClick={function() { setSubPage("data"); }} style={S.pill(subPage === "data", toolColor)}>{dataLabel}{data.length > 0 && <span style={{ fontSize: 10, background: subPage === "data" ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4 }}>{data.length}</span>}</button>
          <button onClick={function() { if (!ok) { lp(); return; } setSubPage("emails"); }} style={Object.assign({}, S.pill(subPage === "emails", toolColor), !ok ? { opacity: 0.5 } : {})}>{!ok && <IconLock />} Email Drafts</button>
          <button onClick={function() { if (!ok) { lp(); return; } setSubPage("contacts"); }} style={Object.assign({}, S.pill(subPage === "contacts", toolColor), !ok ? { opacity: 0.5 } : {})}>{!ok && <IconLock />} Vendor Contacts</button>
        </div>
        <div style={{ flex: 1 }} />
        {runTime && <span style={{ fontSize: 11, color: "#475569" }}>Last: {runTime}{runBy ? " by " + runBy : ""}</span>}
        {data.length > 0 && <span style={S.badge(drafts > 0 ? "success" : "default")}>{drafts > 0 ? <><IconCheck /> {drafts} drafts</> : data.length + " items"}</span>}
        {data.length > 0 && (confirmClear
          ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: "#FCA5A5" }}>Clear?</span><button onClick={clearAll} style={Object.assign({}, S.btn("danger"), { padding: "6px 14px", fontSize: 12 })}>Yes</button><button onClick={function() { setConfirmClear(false); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>No</button></div>
          : <button onClick={function() { setConfirmClear(true); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12, color: "#64748B" })}><IconTrash /> Clear</button>
        )}
      </div>

      {subPage === "data" && <div>
        <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 16, padding: "16px 24px" })}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: toolColor + "20", display: "flex", alignItems: "center", justifyContent: "center", color: toolColor }}><ToolIcon /></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC" }}>{toolLabel}</div><div style={{ fontSize: 12, color: "#64748B" }}>{data.length > 0 ? data.length + " items across " + uniqueVendors.length + " vendors" : "No data synced"}</div></div>
          <button style={Object.assign({}, S.btn(), { padding: "10px 24px" })} onClick={syncData} disabled={loading}>{loading ? <><Spinner /> Syncing...</> : <><IconRefresh /> {data.length > 0 ? "Re-sync" : "Sync Data"}</>}</button>
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
                  if (col.copyable) return <td key={col.key} style={Object.assign({}, S.td, { maxWidth: 280 })}><CopyCell text={vs} toast={toast} accentColor={toolColor} /></td>;
                  if (col.badgeFn) return <td key={col.key} style={S.td}><span style={S.badge(col.badgeFn(vs))}>{vs}</span></td>;
                  return <td key={col.key} style={Object.assign({}, S.td, col.mono ? { fontFamily: "monospace", fontSize: 11 } : {}, col.align === "right" ? { textAlign: "right" } : {}, col.bold ? { fontWeight: 600 } : {}, col.highlightColor ? { color: col.highlightColor } : {})}>{vs}</td>;
                })}</tr>;
              })}</tbody>
            </table>
          </div>
        </>}
        {data.length === 0 && !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#475569" })}><ToolIcon /><p style={{ marginTop: 12, fontSize: 14 }}>Click <strong>Sync Data</strong> to pull {toolLabel.toLowerCase()} from Acumatica.</p></div>}
      </div>}

      {subPage === "emails" && <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC", margin: "0 0 4px" }}>{emailConfig.title}</h3>
        <p style={{ color: "#64748B", fontSize: 12, margin: "0 0 16px" }}>{emailConfig.subtitle}</p>
        {skipVendors.length > 0 && <div style={{ background: "rgba(100,116,139,0.06)", border: "1px solid #1E2433", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#64748B" }}>Skipped: {skipVendors.join(", ")}</div>}
        {drafts > 0 && <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconCheck /><span style={{ fontSize: 13, color: "#6EE7B7" }}><strong>{drafts} draft(s) created!</strong></span></div>}
        {data.length > 0 ? <>
          {emailVendors.map(function(entry) {
            var vendor = entry[0], items = entry[1];
            var email = CONTACTS[vendor] || "";
            var toLine = emailConfig.buildTo(email);
            return <div key={vendor} style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div><div style={{ fontSize: 14, fontWeight: 600, color: "#F8FAFC" }}>{vendor}</div><div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{items.length} items &middot; To: {toLine || "No email on file"}</div></div>
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
        </> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#475569" })}>Sync data first.</div>}
      </div>}

      {subPage === "contacts" && <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC", margin: "0 0 16px" }}>Vendor Contacts</h3>
        <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
            <thead><tr><th style={S.th}>Vendor</th><th style={S.th}>Email(s)</th></tr></thead>
            <tbody>{Object.entries(CONTACTS).filter(function(e) { return e[1]; }).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) { return <tr key={e[0]}><td style={Object.assign({}, S.td, { fontWeight: 500, color: "#E2E8F0" })}>{e[0]}</td><td style={Object.assign({}, S.td, { fontFamily: "monospace", fontSize: 11, color: "#94A3B8" })}>{e[1]}</td></tr>; })}</tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

/* ═══════ PO WAREHOUSE TOOL ═══════ */
function WHT(props) {
  var whKey = props.whKey, cfg = props.cfg, toast = props.toast, ok = props.ok, lp = props.lp, cred = props.cred, gmail = props.gmail;
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
  var storageKey = "wh-data-" + whKey;

  useEffect(function() {
    var m = true;
    (async function() { var s = sGet(storageKey); if (m && s && s.data && s.data.length > 0) { setData(s.data); setEmailSent(s.emailSent || false); setRunBy(s.runBy || null); setRunTime(s.runTime || null); setShipNotes(s.shipNotes || {}); } if (m) setInitLoading(false); })();
    return function() { m = false; };
  }, [storageKey]);

  var persist = useCallback(async function(d, es, by, time, sn) { sSet(storageKey, { data: d, emailSent: es, runBy: by, runTime: time, shipNotes: sn || {} }); }, [storageKey]);
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
        var rows = raw.filter(function(r) { return r.SKUNDC && !EXCLUDED.some(function(ex) { return (r.VendorName || "").toLowerCase().indexOf(ex) >= 0; }); }).map(function(r) { return Object.assign({}, r, { Price: Number(r.Price) || 0, OrderQty: Number(r.OrderQty) || 0, TotalPrice: +((Number(r.Price) || 0) * (Number(r.OrderQty) || 0)).toFixed(2) }); });
        var now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        setData(rows); setRunBy("You"); setRunTime(now); setLoading(false); setSubPage("data"); persist(rows, false, "You", now, {}); setShipNotes({}); toast(cfg.label + ": Fetched " + rows.length + " lines");
      } catch (err) {
        setLoading(false);
        toast("Error: " + err.message, "error");
      }
    })();
  }, [whKey, cred, cfg.label, toast, ok, lp, persist]);
  var clearAll = useCallback(async function() { if (!ok) { lp(); return; } setData([]); setSearch(""); setVendorFilter("all"); setFlagsOnly(false); setEmailSent(false); setConfirmClear(false); setRunBy(null); setRunTime(null); setSubPage("overview"); setShipNotes({}); sDel(storageKey); toast(cfg.label + ": Cleared"); }, [cfg.label, toast, ok, lp, storageKey]);

  var vendorGroups = useMemo(function() { var g = {}; data.forEach(function(r) { if (!g[r.VendorName]) g[r.VendorName] = []; g[r.VendorName].push(r); }); return g; }, [data]);
  var vendorTotals = useMemo(function() { var t = {}; Object.entries(vendorGroups).forEach(function(e) { t[e[0]] = e[1].reduce(function(s, r) { return s + r.TotalPrice; }, 0); }); return t; }, [vendorGroups]);
  var uniqueVendors = useMemo(function() { return Array.from(new Set(data.map(function(r) { return r.VendorName; }))).sort(); }, [data]);
  var totalVal = useMemo(function() { return data.reduce(function(s, r) { return s + r.TotalPrice; }, 0); }, [data]);
  var flags = useMemo(function() { var f = { s: [], so: [], d: [] }; data.forEach(function(r, i) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") f.s.push(i); if (mc === "sell-off item") f.so.push(i); if ((r.SKUNDC || "").indexOf("DECHRA") === 0 || (r.Description || "").toLowerCase().indexOf("dechra") >= 0) f.d.push(i); }); return f; }, [data]);
  var flagCount = flags.s.length + flags.so.length + flags.d.length;
  var emailBlocked = whKey !== "GGM-KY" && flags.s.length > 0;
  var getFlag = function(r) { var mc = (r.MovementClass || "").toLowerCase().trim(); if (mc === "short-dating") return "short"; if (mc === "sell-off item") return "selloff"; if ((r.SKUNDC || "").indexOf("DECHRA") === 0 || (r.Description || "").toLowerCase().indexOf("dechra") >= 0) return "dechra"; return null; };
  var filtered = useMemo(function() { var d = data.slice(); if (search) { var s = search.toLowerCase(); d = d.filter(function(r) { return r.SKUNDC.toLowerCase().indexOf(s) >= 0 || r.Description.toLowerCase().indexOf(s) >= 0 || r.VendorName.toLowerCase().indexOf(s) >= 0; }); } if (vendorFilter !== "all") d = d.filter(function(r) { return r.VendorName === vendorFilter; }); if (flagsOnly) { var fi = new Set(flags.s.concat(flags.so).concat(flags.d)); d = d.filter(function(r) { return fi.has(data.indexOf(r)); }); } return d; }, [data, search, vendorFilter, flagsOnly, flags]);
  var todayStr = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

  if (initLoading) return <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#64748B" })}><Spinner color={cfg.color} size={20} /></div>;

  return (<div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 4, background: "#0B0E14", borderRadius: 10, padding: 3 }}>
        {[{ id: "overview", lb: "Overview" }, { id: "data", lb: "PO Data", ct: data.length || null }, { id: "shipping", lb: "Shipping" }, { id: "email", lb: "Email" }].map(function(n) { return <button key={n.id} onClick={function() { setSubPage(n.id); }} style={S.pill(subPage === n.id, cfg.color)}>{n.lb}{n.ct ? <span style={{ fontSize: 10, background: subPage === n.id ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.2)", padding: "1px 6px", borderRadius: 4 }}>{n.ct}</span> : null}</button>; })}
      </div>
      <div style={{ flex: 1 }} />
      {runTime && <span style={{ fontSize: 11, color: "#475569" }}>Last: {runTime}{runBy ? " by " + runBy : ""}</span>}
      {data.length > 0 && <span style={S.badge(emailSent ? "success" : "default")}>{emailSent ? <><IconCheck /> Sent</> : data.length + " lines"}</span>}
      {data.length > 0 && (confirmClear ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: "#FCA5A5" }}>Clear?</span><button onClick={clearAll} style={Object.assign({}, S.btn("danger"), { padding: "6px 14px", fontSize: 12 })}>Yes</button><button onClick={function() { setConfirmClear(false); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12 })}>No</button></div> : <Gate ok={ok} prompt={lp} onClick={function() { setConfirmClear(true); }} style={Object.assign({}, S.btn("ghost"), { padding: "6px 14px", fontSize: 12, color: "#64748B" })}><IconTrash /> Clear</Gate>)}
    </div>

    {subPage === "overview" && <div>
      <div style={Object.assign({}, S.card, { display: "flex", alignItems: "center", gap: 16, padding: "16px 24px" })}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: cfg.color + "20", display: "flex", alignItems: "center", justifyContent: "center", color: cfg.color }}><IconWH /></div>
        <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC" }}>{cfg.full}</div><div style={{ fontSize: 12, color: "#64748B" }}>{data.length > 0 ? data.length + " lines · " + uniqueVendors.length + " vendors · $" + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "No data loaded"}</div></div>
        <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 24px" })} onClick={fetchData} disabled={loading}>{loading ? <><Spinner /> Fetching...</> : <><IconRefresh /> {data.length > 0 ? "Re-fetch" : "Run PO Fetch"}</>}</Gate>
      </div>
      {data.length > 0 && <>
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          {[{ l: "Lines", v: data.length, c: cfg.color }, { l: "Vendors", v: uniqueVendors.length, c: "#10B981" }, { l: "Value", v: "$" + totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 }), c: "#F59E0B" }, { l: "Flags", v: flagCount || "Clear", c: flagCount ? "#EF4444" : "#10B981" }].map(function(s) { return <div key={s.l} style={S.statCard}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: s.c }} /><div style={{ fontSize: 12, color: "#64748B", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.l}</div><div style={{ fontSize: 28, fontWeight: 700, color: s.l === "Flags" ? s.c : "#F8FAFC", marginTop: 4 }}>{s.v}</div></div>; })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          {Object.entries(vendorGroups).sort(function(a, b) { return a[0].localeCompare(b[0]); }).map(function(e) { var v = e[0], rs = e[1], t = vendorTotals[v], rl = SHIP_RULES[v], st = rl ? evalShip(rl, t) : "No Rule", isFree = st === "Free Shipping"; return <div key={v} style={Object.assign({}, S.card, { padding: "16px 20px", marginBottom: 0 })}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 13, fontWeight: 600, color: "#F8FAFC" }}>{v}</div><div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{rs.length} lines · {rs[0] && rs[0].OrderNbr}</div></div><div style={{ fontSize: 15, fontWeight: 700, color: "#F8FAFC" }}>${t.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div><div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}><IconTruck /><span style={S.badge(isFree ? "success" : "danger")}>{isFree ? <IconCheck /> : <IconAlert />}{st}</span></div></div>; })}
        </div>
      </>}
      {data.length === 0 && !loading && <div style={Object.assign({}, S.card, { textAlign: "center", padding: 60, color: "#475569" })}><IconWH /><p style={{ marginTop: 12, fontSize: 14 }}>Click <strong>Run PO Fetch</strong> to load data for {cfg.full}.</p></div>}
    </div>}

    {subPage === "data" && <div>
      {flagCount > 0 && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconAlert /><span style={{ fontSize: 13, color: "#FCA5A5" }}><strong>Flagged:</strong>{flags.s.length > 0 && " " + flags.s.length + " Short-Dating"}{flags.so.length > 0 && " " + flags.so.length + " Sell-Off"}{flags.d.length > 0 && " " + flags.d.length + " Dechra"}</span></div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input style={Object.assign({}, S.inp, { maxWidth: 260 })} placeholder="Search..." value={search} onChange={function(e) { setSearch(e.target.value); }} />
        <select style={S.sel} value={vendorFilter} onChange={function(e) { setVendorFilter(e.target.value); }}><option value="all">All Vendors</option>{uniqueVendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}</select>
        <button style={S.btn(flagsOnly ? "danger" : "ghost")} onClick={function() { setFlagsOnly(!flagsOnly); }}><IconFilter /> {flagsOnly ? "Flags" : "Filter Flags"}</button>
        <div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: "#64748B" }}>{filtered.length}/{data.length}</span>
      </div>
      {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto", maxHeight: 500 })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr>{["SKU", "Description", "Qty", "Vendor", "PO #", "Reorder", "Max", "Lead", "Min", "Avail", "Price", "Total", "Flag"].map(function(h) { return <th key={h} style={S.th}>{h}</th>; })}</tr></thead>
          <tbody>{filtered.map(function(r, i) { var f = getFlag(r); var bg = f === "short" ? "rgba(239,68,68,0.06)" : f === "selloff" ? "rgba(245,158,11,0.06)" : f === "dechra" ? "rgba(139,92,246,0.06)" : "transparent"; var tc = f === "short" ? "#FCA5A5" : f === "selloff" ? "#FCD34D" : f === "dechra" ? "#C4B5FD" : "#CBD5E1"; return <tr key={i} style={{ background: bg }}><td style={Object.assign({}, S.td, { color: tc, fontFamily: "monospace", fontSize: 11 })}>{r.SKUNDC}</td><td style={Object.assign({}, S.td, { color: tc, maxWidth: 280 })}><CopyCell text={r.Description} toast={toast} color={tc} accentColor={cfg.color} /></td><td style={Object.assign({}, S.td, { color: tc, fontWeight: 600 })}>{r.OrderQty}</td><td style={Object.assign({}, S.td, { color: tc, fontSize: 11 })}>{r.VendorName}</td><td style={Object.assign({}, S.td, { color: tc, fontFamily: "monospace", fontSize: 11 })}>{r.OrderNbr}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{r.ReorderPoint}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{r.MaxQty}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{r.LeadTime}d</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>{r.MinOrderQty}</td><td style={Object.assign({}, S.td, { color: r.QtyAvailable < 0 ? "#EF4444" : tc, fontWeight: r.QtyAvailable < 0 ? 700 : 400, textAlign: "right" })}>{r.QtyAvailable}</td><td style={Object.assign({}, S.td, { color: tc, textAlign: "right" })}>${r.Price.toFixed(2)}</td><td style={Object.assign({}, S.td, { color: "#F8FAFC", fontWeight: 600, textAlign: "right" })}>${r.TotalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}>{f ? <span style={S.badge(f === "short" ? "danger" : f === "selloff" ? "warning" : "purple")}>{f === "short" ? "Short" : f === "selloff" ? "Sell-Off" : "Dechra"}</span> : "\u2014"}</td></tr>; })}</tbody>
        </table>
      </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#475569" })}>Run fetch first.</div>}
    </div>}

    {subPage === "shipping" && <div>
      {data.length > 0 ? <div style={Object.assign({}, S.card, { padding: 0, overflow: "auto" })}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr><th style={S.th}>Vendor</th><th style={Object.assign({}, S.th, { width: 140 })}>PO #</th><th style={Object.assign({}, S.th, { textAlign: "right" })}>Total</th><th style={S.th}>Shipping</th><th style={Object.assign({}, S.th, { width: 200 })}>Price Check Notes</th></tr></thead>
          <tbody>{Object.keys(vendorGroups).sort().map(function(v) { var t = vendorTotals[v], rl = SHIP_RULES[v] || "", st = rl ? evalShip(rl, t) : "No Rule", isFree = st === "Free Shipping"; var sn = shipNotes[v] || {}; return <tr key={v}><td style={Object.assign({}, S.td, { fontWeight: 600, color: "#F8FAFC" })}>{v}</td><td style={S.td}><input style={Object.assign({}, S.inp, { padding: "4px 8px", fontSize: 11, fontFamily: "monospace" })} placeholder="Paste PO #" value={sn.po || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[v] = Object.assign({}, sn, { po: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} /></td><td style={Object.assign({}, S.td, { textAlign: "right", fontWeight: 600, fontFamily: "monospace" })}>${t.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td><td style={S.td}><span style={S.badge(isFree ? "success" : "danger")}>{isFree ? <IconCheck /> : <IconAlert />}{st}</span></td><td style={S.td}><input style={Object.assign({}, S.inp, { padding: "4px 8px", fontSize: 11 })} placeholder="Notes..." value={sn.notes || ""} onChange={function(e) { var updated = Object.assign({}, shipNotes); updated[v] = Object.assign({}, sn, { notes: e.target.value }); setShipNotes(updated); persist(data, emailSent, runBy, runTime, updated); }} /></td></tr>; })}</tbody>
        </table>
      </div> : <div style={Object.assign({}, S.card, { textAlign: "center", padding: 48, color: "#475569" })}>Run fetch first.</div>}
    </div>}

    {subPage === "email" && <div>
      {emailBlocked && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconAlert /><span style={{ fontSize: 13, color: "#FCA5A5" }}><strong>{flags.s.length} short-dated item{flags.s.length > 1 ? "s" : ""}</strong> must be removed from the PO before sending.</span></div>}
      {emailSent && <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}><IconCheck /><span style={{ fontSize: 13, color: "#6EE7B7" }}><strong>Draft created!</strong></span></div>}
      <div style={S.card}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}><span style={{ fontSize: 12, color: "#64748B", fontWeight: 500, width: 50 }}>To:</span><span style={{ fontSize: 13, color: "#E2E8F0" }}>{cfg.emailTo}</span></div>
          <div style={{ display: "flex", gap: 8 }}><span style={{ fontSize: 12, color: "#64748B", fontWeight: 500, width: 50 }}>Subject:</span><span style={{ fontSize: 13, color: "#F8FAFC", fontWeight: 600 }}>{cfg.subjectFn(todayStr)}</span></div>
          <div style={{ borderTop: "1px solid #1E2433", paddingTop: 16, marginTop: 4, fontSize: 13, color: "#E2E8F0", lineHeight: 1.7 }}>Good morning,<br /><br />Attached are today&apos;s POs.<br /><br />Thanks in advance,<br /><br /><span style={{ color: "#64748B", fontStyle: "italic" }}>[Vetcove Signature]</span></div>
        </div>
        <div style={{ marginTop: 20, borderTop: "1px solid #1E2433", paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: "#64748B", fontWeight: 500, marginBottom: 10, textTransform: "uppercase" }}>Attachments ({uniqueVendors.length})</div>
          {uniqueVendors.map(function(v) { return <div key={v} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0B0E14", borderRadius: 8, marginBottom: 4 }}><IconDL /><span style={{ fontSize: 12, color: "#CBD5E1" }}>{v} PO Data - {whKey}.xlsx</span><div style={{ flex: 1 }} /><span style={{ fontSize: 11, color: "#475569" }}>{vendorGroups[v] ? vendorGroups[v].length : 0} rows</span></div>; })}
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn(), { padding: "10px 24px", opacity: (emailSent || emailLoading || emailBlocked) ? 0.5 : 1 })} onClick={async function() {
            if (emailBlocked) { toast("Remove all short-dated items before sending email", "error"); return; }
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
          }} disabled={emailSent || emailLoading || emailBlocked || data.length === 0}><IconMail /> {emailBlocked ? flags.s.length + " Short-Dated Item" + (flags.s.length > 1 ? "s" : "") + " Present" : emailLoading ? "Creating..." : emailSent ? "Draft Created" : "Create Gmail Draft"}</Gate>
          {emailSent && <Gate ok={ok} prompt={lp} style={Object.assign({}, S.btn("danger"), { marginLeft: "auto" })} onClick={clearAll}><IconTrash /> Clear</Gate>}
        </div>
      </div>
    </div>}
  </div>);
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
    { key: "BestKnownDating", label: "Best Dating", highlightColor: "#FCD34D", bold: true },
    { key: "QtyOnHand", label: "Qty", align: "right" },
    { key: "BaseUnit", label: "Unit" },
    { key: "OpenQty", label: "Open", align: "right" },
    { key: "NoteText", label: "Notes" },
  ]; }, []);

  var sdEmail = useMemo(function() { return {
    title: "Generate Email Drafts", subtitle: "One draft per vendor \u2014 asking about better dating availability.", subjectPrefix: "Short-Dating Items \u2013 ",
    buildTo: function(e) { return ["hd-purchaseorders@vetcove.com", e].filter(Boolean).join(", "); },
    tableCols: [{ key: "#", label: "#" }, { key: "Description", label: "Product" }, { key: "InventoryID", label: "Inventory ID" }, { key: "SKUNDC", label: "TruePill SKU" }, { key: "BestKnownDating", label: "Best Known Dating", highlightColor: "#FCD34D" }],
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
    { key: "RecoveryDate", label: "Recovery Date", highlightColor: "#60A5FA", bold: true },
  ]; }, []);

  var bkoEmail = useMemo(function() { return {
    title: "Generate Backorder Emails", subtitle: "One draft per vendor \u2014 asking for recovery ETA updates. CC: hd-purchaseorders@vetcove.com", subjectPrefix: "Backorder Item Status \u2013 ",
    buildTo: function(e) { return e || ""; },
    tableCols: [{ key: "#", label: "#" }, { key: "Description", label: "Product Description" }, { key: "InventoryID", label: "Inventory ID (Mfr No.)" }, { key: "RecoveryDate", label: "Recovery Date", highlightColor: "#60A5FA" }],
  }; }, []);

  if (credLoading) return <div style={{ fontFamily: "sans-serif", background: "#0B0E14", color: "#E2E8F0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner color="#3B82F6" size={24} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  if (!ok) return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#0B0E14", color: "#E2E8F0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.12)}input:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)}`}</style>
      <div style={{ background: "#111520", border: "1px solid #1E2433", borderRadius: 16, padding: 40, width: 420, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}><IconKey /></div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#F8FAFC", margin: "0 0 4px" }}>Inventory Hub</h1>
        <p style={{ fontSize: 11, color: "#64748B", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", margin: "0 0 32px" }}>Vetcove Tools</p>
        <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500, display: "block", marginBottom: 6 }}>Acumatica Username</label><input style={{ background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "10px 14px", color: "#E2E8F0", fontSize: 14, outline: "none", width: "100%" }} value={cred.username} onChange={function(e) { setCred({ username: e.target.value, password: cred.password }); }} placeholder="your.username" /></div>
          <div><label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500, display: "block", marginBottom: 6 }}>Acumatica Password</label><input style={{ background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "10px 14px", color: "#E2E8F0", fontSize: 14, outline: "none", width: "100%" }} type="password" value={cred.password} onChange={function(e) { setCred({ username: cred.username, password: e.target.value }); }} placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} onKeyDown={function(e) { if (e.key === "Enter") login(); }} /></div>
          <button onClick={login} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "12px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8 }}><IconKey /> Sign In</button>
        </div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#065F46" : "#1E293B", color: "#F8FAFC", border: "1px solid " + (toast.t === "success" ? "#10B981" : "#334155"), boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );

  var isWH = page in WH;
  var activeColor = isWH ? WH[page].color : page === "short-dating" ? "#E879F9" : page === "backorder" ? "#F97316" : "#3B82F6";
  var activeLabel = isWH ? WH[page].full : page === "short-dating" ? "Short-Dating Tracker" : page === "backorder" ? "Backorder Tracker" : showLogin ? "Login" : "Shipping Rules";

  function SideLink(p) {
    var active = page === p.id && !showLogin;
    return <div onClick={function() { setPage(p.id); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", fontSize: 14, cursor: "pointer", transition: "all 0.15s", fontWeight: active ? 600 : 400, color: active ? "#F8FAFC" : "#94A3B8", background: active ? p.color + "15" : "transparent", borderRight: active ? "2px solid " + p.color : "2px solid transparent" }}><Dot color={p.color} />{p.label}</div>;
  }

  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#0B0E14", color: "#E2E8F0", minHeight: "100vh", display: "flex" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0B0E14}::-webkit-scrollbar-thumb{background:#1E2433;border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}button:hover{filter:brightness(1.12)}input:focus,select:focus{border-color:#3B82F6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)}tr:hover td{background:rgba(59,130,246,0.04)}`}</style>

      <div style={{ width: 240, background: "#111520", borderRight: "1px solid #1E2433", display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0 }}>
        <div style={{ padding: "0 24px 24px", borderBottom: "1px solid #1E2433", marginBottom: 12 }}>
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px", color: "#F8FAFC", margin: 0 }}>Inventory Hub</p>
          <p style={{ fontSize: 11, color: "#64748B", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 4 }}>Vetcove Tools</p>
        </div>
        <div style={{ padding: "0 12px", marginBottom: 4 }}><div style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>PO Tools</div></div>
        {Object.entries(WH).map(function(e) { return <SideLink key={e[0]} id={e[0]} label={e[1].full} color={e[1].color} />; })}
        <div style={{ padding: "12px 12px 4px", marginTop: 4, borderTop: "1px solid #1E2433" }}><div style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>Inventory Tools</div></div>
        <SideLink id="short-dating" label="Short-Dating" color="#E879F9" />
        <SideLink id="backorder" label="Backorders" color="#F97316" />
        <div style={{ padding: "12px 12px 4px", marginTop: 4, borderTop: "1px solid #1E2433" }}><div style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", padding: "8px 12px" }}>Settings</div></div>
        <div onClick={function() { setPage("rules"); setShowLogin(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", fontSize: 14, cursor: "pointer", fontWeight: page === "rules" && !showLogin ? 600 : 400, color: page === "rules" && !showLogin ? "#F8FAFC" : "#94A3B8", background: page === "rules" && !showLogin ? "rgba(59,130,246,0.1)" : "transparent", borderRight: page === "rules" && !showLogin ? "2px solid #3B82F6" : "2px solid transparent" }}><IconTruck /> Shipping Rules</div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: "0 16px" }}>
          <div style={{ padding: "12px 16px", background: ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid " + (ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)") }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Dot color={ok ? "#10B981" : "#EF4444"} /><span style={{ fontSize: 12, color: ok ? "#6EE7B7" : "#FCA5A5", fontWeight: 500 }}>{ok ? "Connected" : "Not Connected"}</span></div>
            {ok && cred.username && <div style={{ fontSize: 11, color: "#64748B", marginTop: 4, paddingLeft: 16 }}>{cred.username}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={function() { setShowLogin(true); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, background: "transparent", color: "#94A3B8", border: "1px solid #1E2433", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><IconKey /> {ok ? "Update" : "Login"}</button>
              {ok && <button onClick={logout} style={{ background: "transparent", color: "#64748B", border: "1px solid #1E2433", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Logout</button>}
            </div>
          </div>
          <div style={{ padding: "12px 16px", marginTop: 8, background: gmail ? "rgba(59,130,246,0.08)" : "rgba(100,116,139,0.08)", borderRadius: 10, border: "1px solid " + (gmail ? "rgba(59,130,246,0.2)" : "rgba(100,116,139,0.2)") }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><IconGmail /><span style={{ fontSize: 12, color: gmail ? "#93C5FD" : "#94A3B8", fontWeight: 500 }}>{gmail ? "Gmail Connected" : "Gmail Not Connected"}</span></div>
            {gmail && gmail.email && <div style={{ fontSize: 11, color: "#64748B", marginTop: 4, paddingLeft: 22 }}>{gmail.email}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={connectGmail} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, background: "transparent", color: "#94A3B8", border: "1px solid #1E2433", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}><IconGmail /> {gmail ? "Reconnect" : "Connect"}</button>
              {gmail && <button onClick={disconnectGmail} style={{ background: "transparent", color: "#64748B", border: "1px solid #1E2433", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Disconnect</button>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        <div style={{ padding: "16px 32px", borderBottom: "1px solid #1E2433", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0D1017" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{!showLogin && <Dot color={activeColor} />}<span style={{ fontSize: 18, fontWeight: 600, color: "#F8FAFC" }}>{showLogin ? "Acumatica Login" : activeLabel}</span>{isWH && !showLogin && <span style={{ fontSize: 12, background: activeColor + "20", color: activeColor, padding: "3px 10px", borderRadius: 6, fontWeight: 600 }}>{page}</span>}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{!ok && !showLogin && <span style={{ fontSize: 12, color: "#FCA5A5", display: "flex", alignItems: "center", gap: 4 }}><IconLock /> View only</span>}<span style={{ fontSize: 12, color: "#64748B" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></div>
        </div>
        <div style={{ padding: 32, flex: 1 }}>
          {showLogin && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}><div style={{ background: "#111520", border: "1px solid #1E2433", borderRadius: 12, padding: 32, width: 400, textAlign: "center" }}><div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><IconKey /></div><h2 style={{ fontSize: 20, fontWeight: 700, color: "#F8FAFC", margin: "0 0 4px" }}>Acumatica Login</h2><p style={{ color: "#475569", fontSize: 11, margin: "0 0 24px" }}>Shared across all tools</p><div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}><div><label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500, display: "block", marginBottom: 4 }}>Username</label><input style={{ background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none", width: "100%" }} value={cred.username} onChange={function(e) { setCred({ username: e.target.value, password: cred.password }); }} placeholder="your.username" /></div><div><label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500, display: "block", marginBottom: 4 }}>Password</label><input style={{ background: "#0B0E14", border: "1px solid #1E2433", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none", width: "100%" }} type="password" value={cred.password} onChange={function(e) { setCred({ username: cred.username, password: e.target.value }); }} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" /></div><button onClick={login} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>Connect</button></div></div></div>}

          {page === "rules" && !showLogin && <div>
            <p style={{ color: "#64748B", fontSize: 13, marginBottom: 16 }}>Vendor shipping rules for PO warehouses.</p>
            <div style={{ background: "#111520", border: "1px solid #1E2433", borderRadius: 12, padding: 0, overflow: "auto" }}><table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}><thead><tr><th style={{ padding: "10px 12px", textAlign: "left", background: "#0D1017", color: "#64748B", fontWeight: 600, fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #1E2433" }}>Vendor</th><th style={{ padding: "10px 12px", textAlign: "left", background: "#0D1017", color: "#64748B", fontWeight: 600, fontSize: 11, textTransform: "uppercase", borderBottom: "1px solid #1E2433" }}>Rule</th></tr></thead><tbody>{Object.entries(SHIP_RULES).map(function(e) { return <tr key={e[0]}><td style={{ padding: "10px 12px", borderBottom: "1px solid #141822", fontWeight: 500, color: "#E2E8F0" }}>{e[0]}</td><td style={{ padding: "10px 12px", borderBottom: "1px solid #141822", fontFamily: "monospace", fontSize: 11, color: "#94A3B8" }}>{e[1]}</td></tr>; })}</tbody></table></div>
          </div>}

          {!showLogin && Object.entries(WH).map(function(e) { return <div key={e[0]} style={{ display: page === e[0] ? "block" : "none" }}><WHT whKey={e[0]} cfg={e[1]} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} /></div>; })}
          {!showLogin && page === "short-dating" && <TrackerTool toolKey="short-dating" toolLabel="Short-Dating Tracker" toolColor="#E879F9" demoData={SD_DEMO} columns={sdColumns} emailConfig={sdEmail} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} />}
          {!showLogin && page === "backorder" && <TrackerTool toolKey="backorder" toolLabel="Backorder Tracker" toolColor="#F97316" demoData={BKO_DEMO} columns={bkoColumns} emailConfig={bkoEmail} skipVendors={BKO_SKIP} toast={showToast} ok={ok} lp={promptLogin} cred={cred} gmail={gmail} />}
        </div>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 999, background: toast.t === "success" ? "#065F46" : "#1E293B", color: "#F8FAFC", border: "1px solid " + (toast.t === "success" ? "#10B981" : "#334155"), boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "slideUp 0.3s ease" }}>{toast.m}</div>}
    </div>
  );
}
