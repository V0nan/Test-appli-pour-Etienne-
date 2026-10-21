/* Métré & Devis — outil de devis pour peintre / décorateur.
   Données stockées localement (localStorage), sauvegarde/restauration en JSON, base produits en CSV. */
'use strict';
const { html, render, useState, useEffect, useRef } = htmPreact;

/* =========================================================================
   Utilitaires
   ========================================================================= */
const uid = () => Math.random().toString(36).slice(2, 10);
const num = (v) => {
  if (v == null || v === '') return 0;
  let t = String(v).replace(/[\s\u00a0\u202f€]/g, '').replace(/[\u2212\u2013]/g, '-');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return 0;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};
const hasVal = (v) => v != null && v !== '';
// Nombre lisible ? (pour ne pas transformer une cellule vide ou « N/A » en 0)
const isNum = (v) => hasVal(String(v ?? '').trim()) && (num(v) !== 0 || /^[\s+-]*0*[.,]?0*\s*€?\s*$/.test(String(v)));
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : null);
const eur = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const eur0 = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt = (n, d = 2) => (n ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: d });
const pct = (n, d = 1) => (n == null ? '–' : (n * 100).toLocaleString('fr-FR', { maximumFractionDigits: d }) + ' %');
const isoLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const today = () => isoLocal(new Date());
const daysAgo = (n) => isoLocal(new Date(Date.now() - n * 864e5));
const dateFr = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR') : '');
const addDays = (d, n) => new Date(new Date(d + 'T12:00:00').getTime() + n * 864e5).toISOString().slice(0, 10);
const ageDays = (d) => (d ? (Date.now() - new Date(d + 'T12:00:00').getTime()) / 864e5 : Infinity);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const BASES = {
  murs: { label: 'Les murs (m²)', unite: 'm²' },
  plafond: { label: 'Le plafond (m²)', unite: 'm²' },
  sol: { label: 'Le sol (m²)', unite: 'm²' },
  perimetre: { label: 'Le tour de la pièce (plinthes, scotch)', unite: 'm' },
  unite: { label: "À la pièce (porte, radiateur…)", unite: 'u' },
  forfait: { label: 'Un prix fixe (forfait)', unite: 'forfait' },
};
const CATEGORIES = ['Peinture', 'Sous-couche', 'Enduit', 'Revêtement', 'Protection', 'Adhésif / mastic', 'Outillage / consommable', 'Autre'];
const UNITES = ['L', 'kg', 'm²', 'ml', 'rouleau', 'pièce', 'lot'];
const STATUTS = {
  brouillon: 'En cours',
  envoye: 'Envoyé',
  accepte: 'Signé',
  refuse: 'Refusé',
};
const PIECES_COURANTES = ['Salon', 'Séjour', 'Cuisine', 'Chambre', 'Chambre 2', 'Salle de bain', 'WC', 'Couloir', 'Entrée', 'Bureau', 'Cage d\'escalier', 'Buanderie'];

/* =========================================================================
   Stockage
   ========================================================================= */
const KEY = 'metre-devis.v1';
let storageOk = true;
let donneesCorrompues = null; // clé où le texte illisible a été mis de côté
let state = load();
const listeners = new Set();

function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { storageOk = false; return seed(); }
  if (!raw) return seed();
  try {
    return migrate(JSON.parse(raw));
  } catch (e) {
    // On ne réécrit jamais par-dessus des données illisibles : copie de côté d'abord
    const k = KEY + '.illisible-' + today();
    try { localStorage.setItem(k, raw); donneesCorrompues = k; } catch (e2) { storageOk = false; }
    return seed();
  }
}
// Autre onglet / fenêtre : on recharge au lieu d'écraser son travail
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return;
  try { state = migrate(JSON.parse(e.newValue)); listeners.forEach((l) => l()); } catch (err) {}
});
// Complète les données incomplètes (anciennes versions, fichiers abîmés) pour que l'appli ne plante pas
function migrate(s) {
  if (!s || typeof s !== 'object') throw new Error('Données invalides');
  const base = defaultSettings();
  const arr = (x) => (Array.isArray(x) ? x : []);
  s.settings = Object.assign({}, base, s.settings || {});
  s.settings.entreprise = Object.assign({}, base.entreprise, (s.settings && s.settings.entreprise) || {});
  s.produits = arr(s.produits).filter((p) => p && typeof p === 'object')
    .map((p) => ({ categorie: 'Autre', unite: 'pièce', contenance: 1, prix: 0, historique: [], ...p, id: p.id || uid(), nom: String(p.nom || 'Produit sans nom') }));
  s.ouvrages = arr(s.ouvrages).filter((o) => o && typeof o === 'object')
    .map((o) => ({ base: 'murs', temps: 0, ...o, id: o.id || uid(), nom: String(o.nom || 'Ouvrage sans nom'), fournitures: arr(o.fournitures).filter((f) => f && f.produitId) }));
  s.devis = arr(s.devis).filter((d) => d && typeof d === 'object').map((d) => {
    const n = {
      date: today(), statut: 'brouillon', objet: '', chantier: '', remisePct: 0, signe: null, rex: null, notes: '',
      ...d,
      id: d.id || uid(), numero: String(d.numero || '?'),
      client: Object.assign({ nom: '', adresse: '', tel: '', email: '' }, d.client || {}),
      params: Object.assign(paramsFromSettings(s.settings), d.params || {}),
      divers: arr(d.divers).filter(Boolean).map((x) => ({ id: uid(), designation: '', vente: null, cout: null, ...x })),
    };
    if (!STATUTS[n.statut]) n.statut = 'brouillon';
    n.pieces = arr(d.pieces).filter(Boolean).map((p) => ({
      ...nouvellePiece(''), ...p, id: p.id || uid(), nom: String(p.nom || ''),
      lignes: arr(p.lignes).filter((l) => l && l.ouvrage && typeof l.ouvrage === 'object').map((l) => ({
        id: l.id || uid(), qte: l.qte ?? null,
        ouvrage: {
          id: l.ouvrage.id || '', nom: String(l.ouvrage.nom || ''), base: BASES[l.ouvrage.base] ? l.ouvrage.base : 'forfait', temps: l.ouvrage.temps ?? 0,
          fournitures: arr(l.ouvrage.fournitures).filter((f) => f && f.produit && typeof f.produit === 'object'),
        },
      })),
    }));
    return n;
  });
  return s;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch (e) { storageOk = false; }
}
function update(fn) { fn(state); save(); listeners.forEach((l) => l()); }
function useStore() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((x) => x + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return state;
}

let toastTimer;
let toastMsg = '';
let toastAction = null; // { label, fn } : ex. « Annuler »
function toast(msg, action) {
  toastMsg = msg;
  toastAction = action || null;
  listeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg = ''; toastAction = null; listeners.forEach((l) => l()); }, action ? 6000 : 2800);
}

function defaultSettings() {
  return {
    entreprise: {
      nom: '', adresse: '', cp: '', ville: '', tel: '', email: '', siret: '',
      assurance: '', mentions: '',
    },
    tauxHoraire: 45, // prix de vente de l'heure de main d'œuvre (HT)
    coutHoraire: 28, // ce que coûte réellement une heure (charges, véhicule, etc.)
    coefFournitures: 1.25, // coefficient appliqué au prix d'achat des fournitures
    pertes: 0.1, // pertes / surconsommation
    tva: 10,
    margeMini: 0.15, // marge nette en dessous de laquelle on ne descend pas
    validite: 30,
    acompte: 30,
    prochainNumero: 1,
    derniereSauvegarde: null,
    expert: false, // affiche les réglages avancés
    demarre: false, // l'accueil « premiers pas » a été passé
  };
}

/* =========================================================================
   Calculs
   ========================================================================= */
const prodById = (id) => state.produits.find((p) => p.id === id);
const ouvById = (id) => state.ouvrages.find((o) => o.id === id);

function snapProduit(p) {
  return { id: p.id, nom: p.nom, unite: p.unite, contenance: p.contenance, prix: p.prix, rendement: p.rendement };
}
function snapOuvrage(o, produits) {
  return {
    id: o.id, nom: o.nom, base: o.base, temps: o.temps,
    fournitures: o.fournitures
      .map((f) => {
        const p = produits.find((x) => x.id === f.produitId);
        return p ? { produit: snapProduit(p), couches: f.couches, conso: f.conso } : null;
      })
      .filter(Boolean),
  };
}
function paramsFromSettings(s) {
  return { tauxHoraire: s.tauxHoraire, coutHoraire: s.coutHoraire, coefFournitures: s.coefFournitures, pertes: s.pertes, tva: s.tva, margeMini: s.margeMini };
}

function surfaces(p) {
  const L = num(p.L), l = num(p.l), H = num(p.H);
  const per = 2 * (L + l);
  return {
    murs: Math.max(0, per * H - num(p.deduction)),
    plafond: L * l,
    sol: L * l,
    perimetre: Math.max(0, per - num(p.dedPerimetre)),
    unite: 1,
    forfait: 1,
  };
}

// Quantité de produit (dans son unité) par unité de base de l'ouvrage
function consoOf(f, produit) {
  if (hasVal(f.conso)) return num(f.conso);
  const r = num(produit.rendement);
  return r > 0 ? (hasVal(f.couches) ? num(f.couches) : 1) / r : 0;
}

function calcLigne(l, piece, pr) {
  const auto = round2(surfaces(piece)[l.ouvrage.base] ?? 0);
  const qte = Math.max(0, round2(hasVal(l.qte) ? num(l.qte) : auto));
  const heures = qte * num(l.ouvrage.temps);
  const fourn = l.ouvrage.fournitures.map((f) => {
    const p = f.produit;
    const besoin = qte * consoOf(f, p) * (1 + num(pr.pertes));
    const prixUnit = num(p.contenance) > 0 ? num(p.prix) / num(p.contenance) : num(p.prix);
    return { produit: p, besoin, cout: besoin * prixUnit };
  });
  const coutFourn = sum(fourn, (f) => f.cout);
  // Sur le devis client, Qté × PU doit tomber juste : on arrondit le PU, puis le total de la ligne
  const brut = heures * num(pr.tauxHoraire) + coutFourn * num(pr.coefFournitures);
  const pu = qte ? round2(brut / qte) : 0;
  const vente = round2(pu * qte);
  return { qte, auto, heures, fourn, coutFourn, vente, pu, unite: BASES[l.ouvrage.base]?.unite || 'u' };
}

function calcDevis(d) {
  const pr = d.params;
  const pieces = d.pieces.map((p) => ({ piece: p, surf: surfaces(p), lignes: p.lignes.map((l) => ({ ligne: l, c: calcLigne(l, p, pr) })) }));
  const all = pieces.flatMap((p) => p.lignes);
  // Fournitures regroupées : on achète des conditionnements entiers
  const map = new Map();
  for (const { c } of all) {
    for (const f of c.fourn) {
      const k = f.produit.id;
      const e = map.get(k) || { produit: f.produit, besoin: 0 };
      if (num(f.produit.prix) > num(e.produit.prix)) e.produit = f.produit; // si deux versions de prix : la plus prudente
      e.besoin += f.besoin;
      map.set(k, e);
    }
  }
  const courses = [...map.values()].map((e) => {
    const cont = num(e.produit.contenance) || 1;
    const nb = e.besoin > 0 ? Math.ceil(e.besoin / cont - 1e-9) : 0;
    return { ...e, nb, cout: nb * num(e.produit.prix) };
  }).filter((e) => e.besoin > 0);
  const coutFourn = sum(courses, (e) => e.cout);
  const coutFournUtilise = sum(all, (x) => x.c.coutFourn);
  const heures = sum(all, (x) => x.c.heures);
  const coutMO = heures * num(pr.coutHoraire);
  const diversVente = sum(d.divers, (x) => round2(num(x.vente)));
  const diversCout = sum(d.divers, (x) => num(x.cout));
  const sousTotal = round2(sum(all, (x) => x.c.vente) + diversVente);
  const remise = round2(sousTotal * num(d.remisePct) / 100);
  const totalHT = round2(sousTotal - remise);
  const coutTotal = coutFourn + coutMO + diversCout;
  const margeBrute = totalHT - coutFourn - diversCout; // ce qui reste pour payer le temps passé
  const marge = totalHT - coutTotal;
  const margePct = totalHT > 0 ? marge / totalHT : 0;
  const plancher = round2(coutTotal / (1 - Math.min(0.9, num(pr.margeMini))));
  const remisePossible = sousTotal > 0 ? 1 - plancher / sousTotal : 0;
  const tva = round2(totalHT * num(pr.tva) / 100);
  const res = {
    pieces, courses, coutFourn, stock: Math.max(0, coutFourn - coutFournUtilise), heures, coutMO, diversVente, diversCout, sousTotal, remise, totalHT,
    coutTotal, margeBrute, marge, margePct, plancher, remisePossible, nego: totalHT - plancher, tva, ttc: totalHT + tva,
  };
  // Résultat réel (devis signé + retour de chantier)
  if (d.statut === 'accepte') {
    const signe = d.signe && hasVal(d.signe.prixHT) ? num(d.signe.prixHT) : totalHT;
    const rex = d.rex || {};
    const hReel = hasVal(rex.heures) ? num(rex.heures) : null;
    const fReel = hasVal(rex.coutFournitures) ? num(rex.coutFournitures) : null;
    const coutReel = (fReel ?? coutFourn) + (hReel ?? heures) * num(pr.coutHoraire) + diversCout;
    res.signe = signe;
    res.margeSignee = signe - coutTotal;
    res.margeSigneePct = signe > 0 ? (signe - coutTotal) / signe : 0;
    res.negociation = sousTotal > 0 ? 1 - signe / sousTotal : 0;
    res.rexSaisi = hReel != null || fReel != null;
    res.heuresReelles = hReel;
    res.margeReelle = signe - coutReel;
    res.margeReellePct = signe > 0 ? (signe - coutReel) / signe : 0;
  }
  return res;
}

function calcOuvrageIndicatif(o, s) {
  const fake = { ouvrage: snapOuvrage(o, state.produits), qte: 1 };
  const c = calcLigne(fake, {}, paramsFromSettings(s));
  return { ...c, marge: c.vente - c.coutFourn - c.heures * num(s.coutHoraire) };
}

function produitsModifies(d) {
  let n = 0;
  const seen = new Set();
  for (const p of d.pieces) for (const l of p.lignes) for (const f of l.ouvrage.fournitures) {
    const cur = prodById(f.produit.id);
    if (!cur || seen.has(cur.id)) continue;
    if (num(cur.prix) !== num(f.produit.prix) || num(cur.contenance) !== num(f.produit.contenance) || num(cur.rendement) !== num(f.produit.rendement)) {
      n++; seen.add(cur.id);
    }
  }
  return n;
}
// Ne change que les prix / conditionnements des produits, pas les temps ni la composition des ouvrages
function actualiserPrix(d) {
  for (const p of d.pieces) for (const l of p.lignes) for (const f of l.ouvrage.fournitures) {
    const cur = prodById(f.produit.id);
    if (cur) f.produit = snapProduit(cur);
  }
}

function margeClass(p, mini) {
  if (p < mini) return 'mg-bad';
  if (p < mini + 0.08) return 'mg-warn';
  return 'mg-ok';
}

/* =========================================================================
   Création d'objets
   ========================================================================= */
function numeroDevis(s, date) {
  const pris = new Set((s.devis || []).map((d) => d.numero));
  let numero;
  do {
    const n = Math.max(1, Math.round(num(s.settings.prochainNumero)) || 1);
    s.settings.prochainNumero = n + 1;
    numero = `D${(date || today()).slice(0, 4)}-${String(n).padStart(3, '0')}`;
  } while (pris.has(numero));
  return numero;
}
function nouvellePiece(nom) {
  return { id: uid(), nom: nom || '', L: null, l: null, H: 2.5, deduction: null, dedPerimetre: null, lignes: [] };
}
function nouveauDevis(s) {
  return {
    id: uid(), numero: numeroDevis(s), date: today(), statut: 'brouillon',
    client: { nom: '', adresse: '', tel: '', email: '' }, chantier: '', objet: 'Travaux de peinture',
    pieces: [nouvellePiece('')], divers: [], remisePct: 0,
    params: paramsFromSettings(s.settings), signe: null, rex: null, notes: '',
  };
}
function nouvelleLigne(o, produits) { return { id: uid(), ouvrage: snapOuvrage(o, produits), qte: null }; }

/* =========================================================================
   Données d'exemple
   ========================================================================= */
function seed() {
  const s = { settings: defaultSettings(), produits: [], ouvrages: [], devis: [], exemples: true };
  const P = (id, nom, categorie, unite, contenance, prix, rendement, fournisseur, ref) =>
    s.produits.push({ id, nom, categorie, unite, contenance, prix, rendement, fournisseur, ref, maj: daysAgo(40), historique: [], exemple: true });
  P('p1', 'Peinture acrylique mate plafond blanc', 'Peinture', 'L', 15, 96, 10, 'Fournisseur A', 'PLAF-15');
  P('p2', 'Peinture acrylique velours murs blanc', 'Peinture', 'L', 15, 124, 11, 'Fournisseur A', 'VEL-15');
  P('p3', 'Peinture satinée boiseries', 'Peinture', 'L', 2.5, 49, 12, 'Fournisseur A', 'SAT-2.5');
  P('p4', 'Impression acrylique (sous-couche)', 'Sous-couche', 'L', 15, 86, 10, 'Fournisseur A', 'IMP-15');
  P('p5', 'Enduit de rebouchage poudre', 'Enduit', 'kg', 5, 18.5, 6, 'Fournisseur B', 'REB-5');
  P('p6', 'Enduit de lissage pâte', 'Enduit', 'kg', 25, 39, 1, 'Fournisseur B', 'LIS-25');
  P('p7', 'Toile de verre à peindre', 'Revêtement', 'm²', 50, 68, 1, 'Fournisseur B', 'TDV-50');
  P('p8', 'Colle toile de verre', 'Adhésif / mastic', 'kg', 15, 42, 4, 'Fournisseur B', 'COL-15');
  P('p9', 'Bâche de protection polyane 4×25 m', 'Protection', 'rouleau', 1, 22, 80, 'Fournisseur C', 'BAC-100');
  P('p10', 'Ruban de masquage 50 m', 'Adhésif / mastic', 'rouleau', 1, 6.5, 50, 'Fournisseur C', 'SCO-50');
  P('p11', 'Mastic acrylique 310 ml', 'Adhésif / mastic', 'pièce', 1, 4.2, 15, 'Fournisseur C', 'MAS-310');
  P('p12', 'Abrasif grain 120 (lot de 10)', 'Outillage / consommable', 'pièce', 10, 9, 8, 'Fournisseur C', 'ABR-120');
  P('p13', 'Manchon microfibre 180 mm', 'Outillage / consommable', 'pièce', 1, 11.5, 60, 'Fournisseur C', 'MAN-180');
  s.produits[1].historique = [{ date: daysAgo(220), prix: 116 }];
  s.produits[0].historique = [{ date: daysAgo(220), prix: 92 }];

  const O = (id, nom, base, temps, fournitures) => s.ouvrages.push({ id, nom, base, temps, fournitures, exemple: true });
  const F = (produitId, couches, conso) => ({ produitId, couches: couches ?? 1, conso: conso ?? null });
  O('o1', 'Protection des sols', 'sol', 0.03, [F('p9')]);
  O('o2', 'Masquage plinthes et angles', 'perimetre', 0.03, [F('p10', 2)]);
  O('o3', 'Préparation murs (rebouchage, ponçage)', 'murs', 0.08, [F('p5', 1, 0.12), F('p12')]);
  O('o4', 'Ratissage enduit murs', 'murs', 0.25, [F('p6', 1, 0.9), F('p12')]);
  O('o5', 'Impression murs', 'murs', 0.08, [F('p4'), F('p13')]);
  O('o6', 'Peinture murs velours, 2 couches', 'murs', 0.18, [F('p2', 2), F('p13')]);
  O('o7', 'Peinture plafond mat, 2 couches', 'plafond', 0.22, [F('p1', 2), F('p13')]);
  O('o8', 'Peinture porte 2 faces + huisserie', 'unite', 1.5, [F('p3', 1, 0.45), F('p12', 1, 0.3)]);
  O('o9', 'Peinture plinthes satinée', 'perimetre', 0.06, [F('p3', 1, 0.03)]);
  O('o10', 'Pose toile de verre', 'murs', 0.3, [F('p7', 1, 1.1), F('p8', 1)]);
  O('o11', 'Joints mastic (angles, encadrements)', 'perimetre', 0.04, [F('p11')]);

  const mk = ({ client, objet, jours, statut, pieces, taux, remisePct = 0, signeCoef, rexCoef, divers = [] }) => {
    const date = daysAgo(jours);
    const d = nouveauDevis(s);
    d.numero = `D${date.slice(0, 4)}-${String(s.devis.length + 1).padStart(3, '0')}`;
    d.date = date; d.statut = statut; d.exemple = true; d.objet = objet;
    d.client = { nom: client, adresse: '', tel: '', email: '' };
    if (taux) d.params.tauxHoraire = taux;
    d.remisePct = remisePct; d.divers = divers.map((x) => ({ id: uid(), ...x }));
    d.pieces = pieces.map(([nom, L, l, H, ded, ouvrages]) => {
      const p = nouvellePiece(nom);
      Object.assign(p, { L, l, H, deduction: ded });
      p.lignes = ouvrages.map((x) => {
        const [oid, qte] = Array.isArray(x) ? x : [x, null];
        const li = nouvelleLigne(s.ouvrages.find((o) => o.id === oid), s.produits);
        li.qte = qte;
        return li;
      });
      return p;
    });
    const c = calcDevis(d);
    if (statut === 'accepte') {
      d.signe = { date: addDays(date, 9), prixHT: Math.round(c.totalHT * (signeCoef ?? 1)) };
      if (rexCoef) d.rex = { heures: round2(c.heures * rexCoef), coutFournitures: Math.round(c.coutFourn * 1.04), notes: '' };
    }
    s.devis.push(d);
  };
  const std = ['o1', 'o2', 'o3', 'o6', 'o7'];
  mk({ client: 'Mme Martin', objet: 'Peinture salon et couloir', jours: 190, statut: 'accepte', signeCoef: 0.95, rexCoef: 1.12,
    pieces: [['Salon', 5.2, 4.1, 2.5, 5.4, std], ['Couloir', 6, 1.1, 2.5, 4.8, ['o1', 'o3', 'o6', 'o7', ['o8', 3]]]] });
  mk({ client: 'M. Durand', objet: 'Rénovation chambre', jours: 150, statut: 'refuse', taux: 55,
    pieces: [['Chambre', 3.8, 3.2, 2.5, 3.4, ['o1', 'o2', 'o4', 'o5', 'o6', 'o7']]] });
  mk({ client: 'SCI Les Tilleuls', objet: 'Remise en peinture T3 avant location', jours: 110, statut: 'accepte', signeCoef: 0.97, rexCoef: 1.05,
    divers: [{ designation: 'Évacuation des déchets', vente: 80, cout: 35 }],
    pieces: [['Séjour', 5.8, 4.2, 2.5, 6, std], ['Chambre', 3.5, 3.1, 2.5, 3.2, std], ['Chambre 2', 3.2, 3, 2.5, 3.2, std], ['Couloir', 4.5, 1.1, 2.5, 6.4, ['o1', 'o6', 'o7', ['o8', 4]]]] });
  mk({ client: 'M. Petit', objet: 'Cuisine et entrée', jours: 75, statut: 'refuse', taux: 52, remisePct: 0,
    pieces: [['Cuisine', 3.6, 2.8, 2.5, 4.5, ['o1', 'o2', 'o4', 'o5', 'o6', 'o7']], ['Entrée', 2.2, 1.6, 2.5, 3.6, ['o1', 'o3', 'o6', 'o7']]] });
  mk({ client: 'Mme Leroy', objet: 'Chambre enfant, toile de verre', jours: 40, statut: 'accepte', signeCoef: 0.92, rexCoef: 0.97,
    pieces: [['Chambre enfant', 3.4, 3, 2.5, 3.3, ['o1', 'o2', 'o3', 'o10', 'o6', 'o7', ['o8', 1]]]] });
  mk({ client: 'M. Bernard', objet: 'Séjour double', jours: 6, statut: 'envoye',
    pieces: [['Séjour', 7.4, 4.6, 2.6, 8.2, [...std, 'o9', 'o11']]] });
  s.settings.prochainNumero = s.devis.length + 1;
  return s;
}

function effacerExemples() {
  update((s) => {
    s.devis = s.devis.filter((d) => !d.exemple);
    s.exemples = false;
    if (!s.devis.length) s.settings.prochainNumero = 1; // le premier vrai devis sera le n° 001
  });
}

/* =========================================================================
   Import / export
   ========================================================================= */
function download(name, text, type) {
  try {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  } catch (e) { return false; }
}
// Lit un fichier texte ; si ce n'est pas de l'UTF-8 (CSV enregistré par Excel sous Windows), relit en Windows-1252
function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const buf = r.result;
      let t = new TextDecoder('utf-8').decode(buf);
      if (t.includes('\ufffd')) { try { t = new TextDecoder('windows-1252').decode(buf); } catch (e) {} }
      res(t);
    };
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}
const CSV_COLS = ['id', 'ref', 'nom', 'categorie', 'unite', 'contenance', 'prix_ht', 'rendement', 'fournisseur'];
function produitsCSV() {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const dec = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
  const rows = state.produits.map((p) => [p.id, p.ref, p.nom, p.categorie, p.unite, dec(p.contenance), dec(p.prix), dec(p.rendement), p.fournisseur].map(esc).join(';'));
  return '﻿' + CSV_COLS.join(';') + '\n' + rows.join('\n');
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
function importProduitsCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Le fichier ne contient aucune ligne de produit.');
  const head = rows[0].map((h) => norm(h).replace(/[^a-z]/g, ''));
  const idx = (...names) => head.findIndex((h) => names.includes(h));
  const iNom = idx('nom', 'designation', 'produit', 'libelle');
  const iPrix = idx('prixht', 'prix', 'tarif', 'prixachat');
  if (iNom < 0 || iPrix < 0) throw new Error('Colonnes « nom » et « prix_ht » introuvables. Partez du fichier exporté pour garder le bon format.');
  const iId = idx('id'), iRef = idx('ref', 'reference', 'code'), iCat = idx('categorie', 'famille'), iUn = idx('unite'),
    iCont = idx('contenance', 'conditionnement', 'quantite'), iRend = idx('rendement'), iFour = idx('fournisseur');
  let maj = 0, ajout = 0, ignores = 0, ambigus = 0;
  const vus = new Set();
  update((s) => {
    for (const r of rows.slice(1)) {
      const nom = (r[iNom] || '').trim();
      if (!nom) continue;
      const ref = iRef >= 0 ? (r[iRef] || '').trim() : '';
      const id = iId >= 0 ? (r[iId] || '').trim() : '';
      const libres = s.produits.filter((x) => !vus.has(x.id));
      let p = (id && libres.find((x) => x.id === id)) || (ref && libres.find((x) => x.ref && norm(x.ref) === norm(ref)));
      if (!p) {
        const memeNom = libres.filter((x) => norm(x.nom) === norm(nom));
        if (memeNom.length > 1) { ambigus++; continue; } // plusieurs produits portent ce nom : on ne devine pas
        p = memeNom[0];
      }
      if (!isNum(r[iPrix])) { ignores++; continue; } // prix vide ou illisible : on garde le prix actuel
      const prix = num(r[iPrix]);
      if (!p) {
        p = { id: uid(), nom, ref, categorie: 'Autre', unite: 'pièce', contenance: 1, prix, rendement: null, fournisseur: '', maj: today(), historique: [] };
        s.produits.push(p); ajout++;
      } else {
        if (num(p.prix) !== prix) { p.historique = [...(p.historique || []), { date: p.maj, prix: p.prix }].slice(-20); p.maj = today(); }
        p.exemple = false;
        maj++;
      }
      vus.add(p.id);
      p.prix = prix;
      if (!nom.includes('\ufffd')) p.nom = nom;
      if (ref) p.ref = ref;
      if (iCat >= 0 && r[iCat] && !r[iCat].includes('\ufffd')) p.categorie = r[iCat].trim();
      if (iUn >= 0 && r[iUn]) p.unite = r[iUn].trim();
      if (iCont >= 0 && isNum(r[iCont]) && num(r[iCont]) > 0) p.contenance = num(r[iCont]);
      if (iRend >= 0 && isNum(r[iRend])) p.rendement = num(r[iRend]);
      if (iFour >= 0 && r[iFour]) p.fournisseur = r[iFour].trim();
    }
  });
  return { maj, ajout, ignores, ambigus };
}
function exportSauvegarde() {
  return JSON.stringify({ ...state, settings: { ...state.settings, derniereSauvegarde: today() } }, null, 1);
}
function marquerSauvegarde() { update((s) => { s.settings.derniereSauvegarde = today(); }); }
function importSauvegarde(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("Ce fichier n'est pas une sauvegarde Métré & Devis."); }
  if (!data || !Array.isArray(data.produits) || !Array.isArray(data.devis)) throw new Error("Ce fichier n'est pas une sauvegarde Métré & Devis.");
  const nouveau = migrate(data);
  calcAll(nouveau); // vérifie que tout se calcule avant de remplacer quoi que ce soit
  try { localStorage.setItem(KEY + '.avant-restauration', JSON.stringify(state)); } catch (e) {}
  state = nouveau;
  save();
  listeners.forEach((l) => l());
}
function calcAll(s) { for (const d of s.devis) calcDevis(d); }

/* =========================================================================
   Composants de base
   ========================================================================= */
const fmtIn = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
const parseIn = (t) => (String(t).trim() === '' ? null : num(t));

function NumIn({ value, onSet, onCommit, placeholder, id, cls, suffix, signe }) {
  const [txt, setTxt] = useState(fmtIn(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current && parseIn(txt) !== (value ?? null)) setTxt(fmtIn(value)); }, [value]);
  const input = html`<input id=${id} class=${'num ' + (cls || '')} type="text" inputmode=${signe ? 'text' : 'decimal'} autocomplete="off"
    value=${txt} placeholder=${placeholder}
    onFocus=${(e) => { focused.current = true; e.target.select(); }}
    onBlur=${() => { focused.current = false; if (onCommit && !onSet && value != null && parseIn(txt) == null) setTxt(fmtIn(value)); }}
    onInput=${(e) => { const t = e.target.value; setTxt(t); if (onSet) onSet(parseIn(t)); }}
    onChange=${(e) => { if (onCommit) onCommit(parseIn(e.target.value)); }} />`;
  if (!suffix) return input;
  return html`<span class="price-in">${input}<span>${suffix}</span></span>`;
}
function TextIn({ value, onSet, list, placeholder, id, type }) {
  return html`<input id=${id} type=${type || 'text'} list=${list} value=${value || ''} placeholder=${placeholder} onInput=${(e) => onSet(e.target.value)} />`;
}
function Field({ label, hint, wide, children }) {
  return html`<label class=${'field' + (wide ? ' wide' : '')}><span class="lab">${label}</span>${children}${hint ? html`<span class="hint">${hint}</span>` : null}</label>`;
}
function ConfirmBtn({ label, confirm, onConfirm, cls }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return html`<button type="button" class=${'btn danger ' + (cls || '') + (armed ? ' armed' : '')}
    onClick=${() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>${armed ? (confirm || 'Confirmer ?') : label}</button>`;
}
const Pill = ({ statut }) => html`<span class=${'pill st-' + statut}>${STATUTS[statut]}</span>`;

const Icon = {
  devis: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>`,
  produits: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><path d="M6 12h12"/></svg>`,
  ouvrages: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="6" rx="1.5"/><path d="M17 7h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-7v3"/><rect x="10.5" y="15" width="3" height="6" rx="1"/></svg>`,
  bilan: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  reglages: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  back: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  plus: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
};

const Logo = () => html`<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
  <rect x="4" y="5" width="26" height="12" rx="3" fill="var(--accent)"/>
  <rect x="7" y="8" width="20" height="3" rx="1.5" fill="var(--tape)" opacity=".9"/>
  <path d="M30 11h4v8H19v6" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/>
  <rect x="16" y="25" width="6" height="11" rx="2" fill="var(--ink)"/>
</svg>`;

/* =========================================================================
   Application
   ========================================================================= */
const expert = () => !!state.settings.expert;

// Un devis à peine ouvert puis abandonné ne doit pas encombrer la liste
function estVide(d) {
  return !d.client.nom && !d.client.tel && !d.client.adresse && !d.divers.length
    && d.pieces.every((p) => !p.lignes.length && !num(p.L) && !num(p.l));
}
function retirerSiVide(id) {
  const d = state.devis.find((x) => x.id === id);
  if (!d || d.statut !== 'brouillon' || !estVide(d)) return;
  update((s) => {
    s.devis = s.devis.filter((x) => x !== d);
    const n = parseInt(d.numero.split('-')[1], 10);
    if (n === num(s.settings.prochainNumero) - 1) s.settings.prochainNumero = n; // on rend le numéro
  });
}

// Sauvegarde : sur téléphone on propose « Partager » (mail, WhatsApp…), sinon téléchargement
async function sauvegarder() {
  const txt = exportSauvegarde();
  const nom = 'metre-devis-sauvegarde-' + today() + '.json';
  try {
    const file = new File([txt], nom, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde Métré & Devis' });
      marquerSauvegarde(); toast('Sauvegarde envoyée');
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  if (download(nom, txt, 'application/json')) { marquerSauvegarde(); toast('Sauvegarde téléchargée'); }
  else toast('Sauvegarde impossible ici : utilisez « Copier les données » dans Réglages');
}
function sauvegardeEnRetard() {
  const vrais = state.devis.filter((d) => !d.exemple);
  if (!vrais.length) return false;
  const depuis = state.settings.derniereSauvegarde || vrais.map((d) => d.date).sort()[0];
  return ageDays(depuis) > 30;
}

function App() {
  const s = useStore();
  const [tab, setTab] = useState('devis');
  const [devisId, setDevisId] = useState(null);
  const [doc, setDoc] = useState(null); // { id, kind: 'client' | 'courses' }

  useEffect(() => { window.scrollTo(0, 0); }, [tab, devisId, doc && doc.kind]);
  const go = (t) => { if (devisId) retirerSiVide(devisId); setDoc(null); setDevisId(null); setTab(t); };

  if (doc) {
    const d = s.devis.find((x) => x.id === doc.id);
    if (d) return html`<div class="shell">${doc.kind === 'courses'
      ? html`<${Courses} d=${d} onBack=${() => setDoc(null)} />`
      : html`<${DocClient} d=${d} onBack=${() => setDoc(null)} go=${go} />`}</div><${Toast} />`;
  }

  const tabs = [['devis', 'Devis'], ['produits', 'Produits'], ['ouvrages', 'Travaux'], ['bilan', 'Bilan'], ['reglages', 'Réglages']];
  let view;
  if (tab === 'devis') {
    const d = devisId && s.devis.find((x) => x.id === devisId);
    view = d
      ? html`<${DevisEdit} d=${d} onBack=${() => { retirerSiVide(d.id); setDevisId(null); }} onDoc=${(kind) => setDoc({ id: d.id, kind })} onOpen=${setDevisId} />`
      : html`<${DevisList} onOpen=${setDevisId} go=${go} />`;
  } else if (tab === 'produits') view = html`<${Produits} />`;
  else if (tab === 'ouvrages') view = html`<${Ouvrages} />`;
  else if (tab === 'bilan') view = html`<${Bilan} onOpen=${(id) => { setTab('devis'); setDevisId(id); }} />`;
  else view = html`<${Reglages} />`;

  return html`
    <div class="shell">
      <header class="topbar">
        <div class="brand"><${Logo} /><div><div class="brand-name">Métré & Devis</div><div class="brand-sub">${s.settings.entreprise.nom || 'Mon entreprise'}</div></div></div>
        <nav class="tabs" aria-label="Sections">
          ${tabs.map(([k, l]) => html`<button type="button" class=${tab === k ? 'on' : ''} aria-current=${tab === k ? 'page' : null}
            onClick=${() => go(k)}>${Icon[k]}<span>${l}</span></button>`)}
        </nav>
      </header>
      ${donneesCorrompues ? html`<div class="banner warn"><span>Les données enregistrées sur cet appareil étaient illisibles. Elles ont été mises de côté (rien n'est effacé) et l'appli a redémarré avec les exemples. Restaurez votre dernière sauvegarde dans Réglages.</span>
        <button type="button" class="btn sm" onClick=${() => { try { download('donnees-illisibles-' + today() + '.json', localStorage.getItem(donneesCorrompues) || '', 'application/json'); } catch (e) {} }}>Télécharger les données mises de côté</button></div>` : null}
      ${!storageOk ? html`<div class="banner warn">Ce navigateur ne peut pas enregistrer les données : elles seront perdues à la fermeture. Ouvrez l'appli dans un navigateur normal (pas en navigation privée).</div>` : null}
      ${view}
    </div>
    <${Toast} />`;
}
function Toast() {
  if (!toastMsg) return null;
  return html`<div class="toast" role="status"><span>${toastMsg}</span>${toastAction ? html`<button type="button" class="toast-btn" onClick=${() => { const a = toastAction; toastMsg = ''; toastAction = null; a.fn(); listeners.forEach((l) => l()); }}>${toastAction.label}</button>` : null}</div>`;
}

/* ---------------------------------------------------------- Premiers pas */
function Accueil({ onNouveau, go }) {
  const st = state.settings;
  const e = st.entreprise;
  const set = (fn) => update(() => fn(st));
  const ok1 = !!(e.nom && e.tel);
  return html`<div class="card welcome">
    <h2>Bienvenue ! On démarre en 3 étapes</h2>
    <div class="steps">
      <div class=${'step' + (ok1 ? ' done' : '')}>
        <span class="step-n">1</span>
        <div class="grow stack">
          <b>Mon entreprise</b>
          <span class="muted">Nom, adresse, SIRET, assurance : ils apparaissent sur vos devis.</span>
          <div><button type="button" class="btn" onClick=${() => go('reglages')}>${ok1 ? 'Modifier' : 'Remplir'}</button></div>
        </div>
      </div>
      <div class="step">
        <span class="step-n">2</span>
        <div class="grow stack">
          <b>Mon prix de l'heure</b>
          <div class="fields">
            <${Field} label="Prix de l'heure pour le client"><${NumIn} id="w-th" value=${st.tauxHoraire} suffix="€/h" onSet=${(v) => set((st) => { st.tauxHoraire = v; })} /><//>
            <${Field} label="Ce que vous coûte une heure" hint="Charges, camion, assurance, votre salaire"><${NumIn} id="w-ch" value=${st.coutHoraire} suffix="€/h" onSet=${(v) => set((st) => { st.coutHoraire = v; })} /><//>
          </div>
        </div>
      </div>
      <div class="step">
        <span class="step-n">3</span>
        <div class="grow stack">
          <b>Mon premier devis</b>
          <span class="muted">Vos prix de produits sont des exemples pour l'instant : corrigez-les dans « Produits » quand vous avez le temps.</span>
          <div><button type="button" class="btn primary big" onClick=${() => { set((st) => { st.demarre = true; }); onNouveau(); }}>Faire mon premier devis</button></div>
        </div>
      </div>
    </div>
    <div class="row"><button type="button" class="btn ghost" onClick=${() => set((st) => { st.demarre = true; })}>Regarder d'abord les exemples</button></div>
  </div>`;
}

/* ---------------------------------------------------------- Liste des devis */
function aCompleter(d) {
  return d.statut === 'accepte' && !(d.rex && (hasVal(d.rex.heures) || hasVal(d.rex.coutFournitures))) && ageDays(d.signe?.date || d.date) > 30;
}
function DevisList({ onOpen, go }) {
  const s = state;
  const [filtre, setFiltre] = useState('tous');
  const [q, setQ] = useState('');
  const list = s.devis
    .filter((d) => filtre === 'tous' || d.statut === filtre)
    .filter((d) => !q || norm(d.client.nom + ' ' + d.numero + ' ' + d.objet).includes(norm(q)))
    .slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.numero.localeCompare(a.numero));
  const counts = Object.fromEntries(Object.keys(STATUTS).map((k) => [k, s.devis.filter((d) => d.statut === k).length]));
  const nouveau = () => { let id; update((st) => { const d = nouveauDevis(st); st.devis.push(d); id = d.id; }); onOpen(id); };
  const exemples = s.devis.some((d) => d.exemple);

  if (!s.settings.demarre) return html`<section class="section"><h1>Devis</h1><${Accueil} onNouveau=${nouveau} go=${go} /></section>`;

  return html`<section class="section">
    <div class="section-head">
      <h1>Devis</h1>
      <button type="button" class="btn primary big" onClick=${nouveau}>${Icon.plus} Nouveau devis</button>
    </div>
    ${exemples ? html`<div class="banner info"><span>Les devis marqués « exemple » servent seulement à découvrir l'appli.</span>
      <${ConfirmBtn} cls="sm plain" label="Supprimer les exemples" onConfirm=${() => { effacerExemples(); toast('Exemples supprimés'); }} /></div>` : null}
    ${sauvegardeEnRetard() ? html`<div class="banner warn"><span>Pensez à mettre vos devis à l'abri (sauvegarde).</span>
      <button type="button" class="btn sm" onClick=${sauvegarder}>Sauvegarder maintenant</button></div>` : null}
    ${s.devis.length > 4 ? html`<div class="row">
      <div class="grow" style="flex-basis:220px"><input id="q-devis" type="search" placeholder="Rechercher un client…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="chips">
        <button type="button" class=${'chip' + (filtre === 'tous' ? ' on' : '')} onClick=${() => setFiltre('tous')}>Tous ${s.devis.length}</button>
        ${Object.entries(STATUTS).map(([k, l]) => html`<button type="button" class=${'chip' + (filtre === k ? ' on' : '')} onClick=${() => setFiltre(k)}>${l} ${counts[k]}</button>`)}
      </div>
    </div>` : null}
    ${list.length === 0
      ? html`<div class="card empty"><p>${s.devis.length ? 'Aucun devis ne correspond.' : 'Aucun devis pour le moment.'}</p><button type="button" class="btn primary big" onClick=${nouveau}>Faire un devis</button></div>`
      : html`<div class="dlist">${list.map((d) => {
        const c = calcDevis(d);
        const p = d.statut === 'accepte' ? c.margeSigneePct : c.margePct;
        return html`<button type="button" class="ditem" key=${d.id} onClick=${() => onOpen(d.id)}>
          <div class="who">${d.client.nom || 'Client sans nom'}${d.exemple ? html` <span class="tag-ex">exemple</span>` : null}</div>
          <div class="amt">${eur0(d.statut === 'accepte' ? c.signe : c.totalHT)}<span class="small muted"> HT</span></div>
          <div class="meta"><${Pill} statut=${d.statut} />${aCompleter(d) ? html`<span class="pill st-todo">Chantier à compléter</span>` : null}<span>${dateFr(d.date)}</span><span>${d.objet}</span></div>
          <div class="mg">bénéfice <b class=${margeClass(p, num(d.params.margeMini))}>${pct(p, 0)}</b></div>
        </button>`;
      })}</div>`}
  </section>`;
}

/* ---------------------------------------------------------- Édition d'un devis */
function DevisEdit({ d, onBack, onDoc, onOpen }) {
  const c = calcDevis(d);
  const [detail, setDetail] = useState(false);
  const [plusClient, setPlusClient] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [finChantier, setFinChantier] = useState(!!(d.rex && (hasVal(d.rex.heures) || hasVal(d.rex.coutFournitures))));
  const set = (fn) => update(() => fn(d));
  const nbModifs = d.statut === 'brouillon' ? produitsModifies(d) : 0;
  const mini = num(d.params.margeMini);
  const ref = refAcceptes(d.id);

  const setStatut = (st) => set((d) => {
    d.statut = st;
    if (st === 'accepte' && !d.signe) d.signe = { date: today(), prixHT: c.totalHT };
  });
  const dupliquer = () => {
    let id;
    update((st) => {
      const n = JSON.parse(JSON.stringify(d));
      Object.assign(n, { id: uid(), numero: numeroDevis(st), date: today(), statut: 'brouillon', signe: null, rex: null, exemple: false });
      n.pieces.forEach((p) => { p.id = uid(); p.lignes.forEach((l) => { l.id = uid(); }); });
      st.devis.push(n); id = n.id;
    });
    toast('Devis copié : vous êtes sur la copie');
    onOpen(id);
  };
  const prixCible = (v) => {
    if (v == null || c.sousTotal <= 0) return;
    if (v > c.sousTotal) { toast('Ce prix est au-dessus du prix calculé : pas de remise à appliquer.'); return; }
    set((d) => { d.remisePct = Math.round(Math.max(0, (1 - v / c.sousTotal) * 100) * 1e4) / 1e4; });
  };
  const rp = c.remisePossible;

  return html`<section class="section">
    <div class="row between">
      <button type="button" class="btn ghost" onClick=${onBack}>${Icon.back} Mes devis</button>
      <span class="muted">${d.numero}${d.exemple ? html` · <span class="tag-ex">exemple</span>` : null}</span>
    </div>
    <div class="status-bar" role="group" aria-label="Où en est ce devis">${Object.entries(STATUTS).map(([k, l]) => html`<button type="button" class=${'st-' + k + (d.statut === k ? ' on' : '')} aria-pressed=${d.statut === k} onClick=${() => setStatut(k)}>${l}</button>`)}</div>

    ${nbModifs ? html`<div class="banner warn"><span>Le prix de ${nbModifs} produit${nbModifs > 1 ? 's a' : ' a'} changé depuis que ce devis a été commencé.</span>
      <button type="button" class="btn sm" onClick=${() => { set(actualiserPrix); toast('Prix mis à jour'); }}>Prendre les nouveaux prix</button></div>` : null}

    ${d.statut === 'accepte' ? html`<div class="card signe">
      <span class="tape">Devis signé</span>
      <div class="fields">
        <${Field} label="Prix signé HT" hint=${c.negociation > 0.0005 ? 'Soit ' + pct(c.negociation) + ' de moins que le prix de départ' : 'Le prix du devis. Changez-le si vous avez négocié.'}><${NumIn} id="sg-prix" value=${d.signe?.prixHT} suffix="€" onSet=${(v) => set((d) => { d.signe = { ...(d.signe || {}), prixHT: v }; })} /><//>
        <${Field} label="Signé le"><input id="sg-date" type="date" value=${d.signe?.date || ''} onInput=${(e) => set((d) => { d.signe = { ...(d.signe || {}), date: e.target.value }; })} /><//>
      </div>
      ${!finChantier ? html`<div><button type="button" class="btn" onClick=${() => setFinChantier(true)}>Chantier terminé ? Notez le temps passé</button></div>` : html`
        <p><b>Chantier terminé</b> <span class="muted">— pour savoir ce que vous avez vraiment gagné</span></p>
        <div class="fields">
          <${Field} label="Heures passées en vrai" hint=${'Prévu : ' + fmt(c.heures, 1) + ' h'}><${NumIn} id="rx-h" value=${d.rex?.heures} suffix="h" onSet=${(v) => set((d) => { d.rex = { ...(d.rex || {}), heures: v }; })} /><//>
          <${Field} label="Produits achetés en vrai (HT)" hint=${'Prévu : ' + eur0(c.coutFourn) + '. Laissez vide si pareil.'}><${NumIn} id="rx-f" value=${d.rex?.coutFournitures} suffix="€" onSet=${(v) => set((d) => { d.rex = { ...(d.rex || {}), coutFournitures: v }; })} /><//>
        </div>
        ${c.rexSaisi ? html`<p class="big-line">Bénéfice réel : <b class=${margeClass(c.margeReellePct, mini)}>${eur0(c.margeReelle)} (${pct(c.margeReellePct, 0)})</b> <span class="muted">au lieu de ${pct(c.margeSigneePct, 0)} prévu</span></p>` : null}`}
    </div>` : null}

    <div class="card">
      <span class="tape">Client</span>
      <div class="fields">
        <${Field} label="Nom du client"><${TextIn} id="cl-nom" value=${d.client.nom} placeholder="Ex. Mme Martin" onSet=${(v) => set((d) => { d.client.nom = v; })} /><//>
        <${Field} label="Téléphone"><${TextIn} id="cl-tel" type="tel" value=${d.client.tel} onSet=${(v) => set((d) => { d.client.tel = v; })} /><//>
        <${Field} label="Adresse" wide><${TextIn} id="cl-adr" value=${d.client.adresse} onSet=${(v) => set((d) => { d.client.adresse = v; })} /><//>
        ${plusClient ? html`
          <${Field} label="E-mail"><${TextIn} id="cl-mail" type="email" value=${d.client.email} onSet=${(v) => set((d) => { d.client.email = v; })} /><//>
          <${Field} label="Date du devis"><input id="cl-date" type="date" value=${d.date} onInput=${(e) => set((d) => { d.date = e.target.value; })} /><//>
          <${Field} label="Adresse du chantier" hint="Si ce n'est pas chez le client" wide><${TextIn} id="cl-ch" value=${d.chantier} onSet=${(v) => set((d) => { d.chantier = v; })} /><//>
          <${Field} label="Titre du devis" wide><${TextIn} id="cl-obj" value=${d.objet} onSet=${(v) => set((d) => { d.objet = v; })} /><//>` : null}
      </div>
      ${!plusClient ? html`<div><button type="button" class="btn ghost" onClick=${() => setPlusClient(true)}>+ E-mail, date, adresse du chantier…</button></div>` : null}
    </div>

    <datalist id="pieces-courantes">${PIECES_COURANTES.map((n) => html`<option value=${n}></option>`)}</datalist>
    <div class="section-head"><span class="tape">Les pièces</span><span class="muted">Mesures en mètres</span></div>
    ${d.pieces.map((p, i) => html`<${PieceCard} key=${p.id} d=${d} p=${p} i=${i} calc=${c.pieces[i]} />`)}
    <div class="row">
      <button type="button" class="btn big" onClick=${() => set((d) => { d.pieces.push(nouvellePiece('')); })}>${Icon.plus} Ajouter une pièce</button>
    </div>

    ${d.divers.length || expert() ? html`<div class="card">
      <div class="row between"><span class="tape">Lignes libres</span><span class="muted small">Déplacement, évacuation, location…</span></div>
      ${d.divers.map((x) => html`<div class="frow" key=${x.id}>
        <${Field} label="Ce que c'est"><${TextIn} id=${'dv-n-' + x.id} value=${x.designation} placeholder="Ex. Évacuation des déchets" onSet=${(v) => set(() => { x.designation = v; })} /><//>
        <${Field} label="Prix HT"><${NumIn} id=${'dv-v-' + x.id} value=${x.vente} onSet=${(v) => set(() => { x.vente = v; })} /><//>
        <${Field} label="Vous coûte"><${NumIn} id=${'dv-c-' + x.id} value=${x.cout} onSet=${(v) => set(() => { x.cout = v; })} /><//>
        <button type="button" class="x" aria-label="Supprimer la ligne" onClick=${() => set((d) => { d.divers = d.divers.filter((y) => y !== x); })}>×</button>
      </div>`)}
      <div><button type="button" class="btn" onClick=${() => set((d) => { d.divers.push({ id: uid(), designation: '', vente: null, cout: null }); })}>${Icon.plus} Ligne libre</button></div>
    </div>` : html`<div><button type="button" class="btn ghost" onClick=${() => set((d) => { d.divers.push({ id: uid(), designation: '', vente: null, cout: null }); })}>+ Ajouter une ligne libre (déplacement, évacuation…)</button></div>`}

    <div class="card">
      <span class="tape">Remise</span>
      <div class="chips">${[0, 5, 10, 15].map((r) => html`<button type="button" class=${'chip big' + (num(d.remisePct) === r ? ' on' : '')} onClick=${() => set((d) => { d.remisePct = r; })}>${r ? '− ' + r + ' %' : 'Aucune'}</button>`)}</div>
      <div class="fields">
        <${Field} label="Autre remise"><${NumIn} id="rm-pct" value=${d.remisePct} suffix="%" onSet=${(v) => set((d) => { d.remisePct = v ?? 0; })} /><//>
        <${Field} label="Ou le prix que veut le client (HT)" hint="La remise se calcule toute seule"><${NumIn} id="rm-cible" placeholder=${fmt(c.totalHT, 0)} suffix="€" onCommit=${prixCible} /><//>
      </div>
      <p class=${c.totalHT >= c.plancher ? 'mg-ok' : 'mg-bad'}><b>${c.totalHT >= c.plancher ? 'Remise possible jusqu\'à ' + pct(Math.max(0, rp), 0) + ' du prix de départ.' : 'Attention : ce prix est sous votre prix mini.'}</b> Prix mini : ${eur0(c.plancher)} HT.</p>
      ${expert() ? html`<div><button type="button" class="btn ghost sm" onClick=${() => setShowParams(!showParams)}>${showParams ? 'Masquer les tarifs de ce devis' : 'Tarifs de ce devis'}</button></div>` : null}
      ${showParams && expert() ? html`<div class="fields">
        <${Field} label="Prix de l'heure"><${NumIn} id="pa-th" value=${d.params.tauxHoraire} suffix="€/h" onSet=${(v) => set((d) => { d.params.tauxHoraire = v; })} /><//>
        <${Field} label="Coût de l'heure"><${NumIn} id="pa-ch" value=${d.params.coutHoraire} suffix="€/h" onSet=${(v) => set((d) => { d.params.coutHoraire = v; })} /><//>
        <${Field} label="Marge sur produits"><${NumIn} id="pa-cf" value=${round2((num(d.params.coefFournitures) - 1) * 100)} suffix="%" onSet=${(v) => set((d) => { d.params.coefFournitures = 1 + num(v) / 100; })} /><//>
        <${Field} label="Perte de produit"><${NumIn} id="pa-pe" value=${round2(num(d.params.pertes) * 100)} suffix="%" onSet=${(v) => set((d) => { d.params.pertes = num(v) / 100; })} /><//>
        <${Field} label="TVA"><${NumIn} id="pa-tva" value=${d.params.tva} suffix="%" onSet=${(v) => set((d) => { d.params.tva = v; })} /><//>
        <${Field} label="Bénéfice minimum"><${NumIn} id="pa-mm" value=${round2(num(d.params.margeMini) * 100)} suffix="%" onSet=${(v) => set((d) => { d.params.margeMini = num(v) / 100; })} /><//>
      </div>` : null}
    </div>

    <div class="card">
      <span class="tape">C'est prêt ?</span>
      <button type="button" class="btn primary big" onClick=${() => onDoc('client')}>Voir le devis à envoyer (PDF)</button>
      <button type="button" class="btn big" onClick=${() => onDoc('courses')}>Liste de courses (pots à acheter)</button>
      <${Field} label="Notes pour moi (pas sur le devis)"><textarea id="dv-notes" value=${d.notes || ''} onInput=${(e) => set((d) => { d.notes = e.target.value; })}></textarea><//>
      <div class="row">
        <button type="button" class="btn" onClick=${dupliquer}>Faire une copie</button>
        <${ConfirmBtn} label="Supprimer ce devis" confirm="Supprimer pour de bon ?" onConfirm=${() => { onBack(); update((st) => { st.devis = st.devis.filter((x) => x.id !== d.id); }); toast('Devis supprimé'); }} />
      </div>
    </div>

    <div class="summary" aria-live="polite">
      <div class="main">
        <div><div class="tot">${eur(c.totalHT)} <span class="small" style="font-weight:500">HT</span></div><div class="ttc">${eur(c.ttc)} TTC pour le client</div></div>
        <div class="mgbox"><div class="small" style="opacity:.8">votre bénéfice</div><div class=${'mgv ' + (c.totalHT > 0 ? margeClass(c.margePct, mini) : '')}>${c.totalHT > 0 ? eur0(c.marge) + ' · ' + pct(c.margePct, 0) : '–'}</div></div>
      </div>
      ${c.totalHT > 0 ? html`<div class=${'sum-line ' + (c.totalHT >= c.plancher ? '' : 'mg-bad')}>${c.totalHT >= c.plancher
        ? html`Remise possible jusqu'à <b>${pct(Math.max(0, rp), 0)}</b> · prix mini <b>${eur0(c.plancher)}</b> HT`
        : html`Sous votre prix mini (${eur0(c.plancher)} HT)`}</div>` : null}
      <button type="button" class="toggle" onClick=${() => setDetail(!detail)}>${detail ? 'Masquer le détail' : 'Voir le détail du prix'}</button>
      ${detail ? html`<dl>
        <dt>Produits achetés</dt><dd>${eur(c.coutFourn)}</dd>
        ${c.stock > 1 ? html`<dt class="sub-dt">dont produit qui vous restera</dt><dd class="sub-dt">${eur0(c.stock)}</dd>` : null}
        <dt>Votre temps (${fmt(c.heures, 1)} h × ${eur0(num(d.params.coutHoraire))})</dt><dd>${eur(c.coutMO)}</dd>
        ${c.diversCout ? html`<dt>Lignes libres (ce qu'elles vous coûtent)</dt><dd>${eur(c.diversCout)}</dd>` : null}
        <dt>Total de ce que ça vous coûte</dt><dd>${eur(c.coutTotal)}</dd>
        <div class="sep"></div>
        <dt>Bénéfice</dt><dd>${eur(c.marge)}</dd>
        <dt>Prix mini (bénéfice ${pct(mini, 0)})</dt><dd>${eur(c.plancher)}</dd>
        ${ref ? html`<div class="sep"></div><dt>Bénéfice moyen de vos devis signés</dt><dd>${pct(ref.moy, 0)}</dd>` : null}
      </dl>` : null}
    </div>
  </section>`;
}

function refAcceptes(exceptId) {
  const acc = state.devis.filter((d) => d.statut === 'accepte' && d.id !== exceptId).map(calcDevis);
  if (!acc.length) return null;
  return { moy: avg(acc.map((c) => c.margeSigneePct)), nego: avg(acc.map((c) => c.negociation)), n: acc.length };
}

// Travaux les plus utilisés dans les devis (pour les boutons rapides)
function travauxFrequents() {
  const n = new Map();
  for (const d of state.devis) for (const p of d.pieces) for (const l of p.lignes) n.set(l.ouvrage.id, (n.get(l.ouvrage.id) || 0) + 1);
  return state.ouvrages.slice().sort((a, b) => (n.get(b.id) || 0) - (n.get(a.id) || 0)).slice(0, 6);
}

function PieceCard({ d, p, i, calc }) {
  const set = (fn) => update(() => fn(p));
  const sf = calc.surf;
  const ouvrages = state.ouvrages.slice().sort((a, b) => a.nom.localeCompare(b.nom));
  const prev = i > 0 ? d.pieces[i - 1] : null;
  const total = sum(calc.lignes, (x) => x.c.vente);
  const presents = new Set(p.lignes.map((l) => l.ouvrage.id));
  const rapides = travauxFrequents().filter((o) => !presents.has(o.id)).slice(0, 4);
  const addOuv = (id) => { const o = ouvById(id); if (o) set((p) => { p.lignes.push(nouvelleLigne(o, state.produits)); }); };
  const retirer = (l) => {
    const idx = p.lignes.indexOf(l);
    set((p) => { p.lignes = p.lignes.filter((y) => y !== l); });
    toast('« ' + l.ouvrage.nom + ' » retiré', { label: 'Annuler', fn: () => update(() => { p.lignes.splice(idx, 0, l); }) });
  };
  const nomVide = !p.nom || /^Pièce \d+$/.test(p.nom);
  const ouv = (k, m2, per) => set((p) => {
    p[k] = Math.max(0, num(p[k]) + (m2 > 0 ? 1 : -1));
    p.deduction = Math.max(0, round2(num(p.deduction) + m2)) || null;
    p.dedPerimetre = Math.max(0, round2(num(p.dedPerimetre) + per)) || null;
  });

  return html`<div class="card piece">
    <div class="piece-head">
      <div class="grow"><input id=${'pc-n-' + p.id} type="text" list="pieces-courantes" value=${p.nom} placeholder="Nom de la pièce" onInput=${(e) => set((p) => { p.nom = e.target.value; })} /></div>
      <span class="num piece-tot">${eur0(total)}</span>
    </div>
    ${nomVide ? html`<div class="chips">${['Salon', 'Chambre', 'Cuisine', 'Salle de bain', 'Couloir', 'Entrée'].map((n) => html`<button type="button" class="chip" onClick=${() => set((p) => { p.nom = n; })}>${n}</button>`)}</div>` : null}
    <div class="fields tight">
      <${Field} label="Longueur"><${NumIn} id=${'pc-L-' + p.id} value=${p.L} placeholder="0" onSet=${(v) => set((p) => { p.L = v; })} /><//>
      <${Field} label="Largeur"><${NumIn} id=${'pc-l-' + p.id} value=${p.l} placeholder="0" onSet=${(v) => set((p) => { p.l = v; })} /><//>
      <${Field} label="Hauteur"><${NumIn} id=${'pc-H-' + p.id} value=${p.H} placeholder="2,5" onSet=${(v) => set((p) => { p.H = v; })} /><//>
    </div>
    <div class="ouvertures">
      <span class="lab">Portes et fenêtres (enlevées des murs)</span>
      ${[['nbPortes', 'Portes', 1.6, 0.8], ['nbFenetres', 'Fenêtres', 1.5, 0], ['nbPF', 'Portes-fenêtres', 2.6, 1.2]].map(([k, l, m2, per]) => html`<div class="counter">
        <span>${l}</span>
        <button type="button" class="cbtn" aria-label=${'Une ' + l.toLowerCase().slice(0, -1) + ' de moins'} disabled=${!num(p[k])} onClick=${() => ouv(k, -m2, -per)}>−</button>
        <b class="num">${num(p[k])}</b>
        <button type="button" class="cbtn" aria-label=${'Une ' + l.toLowerCase().slice(0, -1) + ' de plus'} onClick=${() => ouv(k, m2, per)}>+</button>
      </div>`)}
      <${Field} label="Ou surface à enlever (m²)"><${NumIn} id=${'pc-d-' + p.id} value=${p.deduction} placeholder="0" onSet=${(v) => set((p) => { p.deduction = v; })} /><//>
    </div>
    <div class="surf">
      <span>Murs <b>${fmt(sf.murs, 1)} m²</b></span><span>Plafond <b>${fmt(sf.plafond, 1)} m²</b></span><span>Sol <b>${fmt(sf.sol, 1)} m²</b></span><span>Tour de pièce <b>${fmt(sf.perimetre, 1)} m</b></span>
    </div>
    ${calc.lignes.length ? html`<div class="lignes">${calc.lignes.map(({ ligne: l, c }) => html`<div class="ligne" key=${l.id}>
      <div class="nm">${l.ouvrage.nom}<div class="sub">${eur(c.pu)} / ${c.unite}${hasVal(l.qte) && l.ouvrage.base !== 'unite' && l.ouvrage.base !== 'forfait' ? html` · <button type="button" class="linkbtn" onClick=${() => update(() => { l.qte = null; })}>remettre le calcul auto</button>` : (l.ouvrage.base === 'unite' || l.ouvrage.base === 'forfait' ? '' : ' · calcul auto')}</div></div>
      <${NumIn} id=${'lg-q-' + l.id} value=${hasVal(l.qte) ? l.qte : c.auto} onSet=${(v) => update(() => { l.qte = v; })} />
      <span class="u">${c.unite}</span>
      <span class="px">${eur(c.vente)}</span>
      <button type="button" class="x" aria-label=${'Retirer ' + l.ouvrage.nom} onClick=${() => retirer(l)}>×</button>
    </div>`)}</div>` : html`<p class="muted">Quels travaux dans cette pièce ? Touchez-les ci-dessous.</p>`}
    ${prev && prev.lignes.length && !p.lignes.length ? html`<button type="button" class="btn primary" onClick=${() => set((p) => { p.lignes = prev.lignes.map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: uid(), qte: l.ouvrage.base === 'unite' || l.ouvrage.base === 'forfait' ? l.qte : null })); })}>Mêmes travaux que « ${prev.nom || 'la pièce d\'avant'} »</button>` : null}
    ${rapides.length ? html`<div class="chips">${rapides.map((o) => html`<button type="button" class="chip add" onClick=${() => addOuv(o.id)}>+ ${o.nom}</button>`)}</div>` : null}
    <select id=${'pc-add-' + p.id} aria-label="Ajouter un autre travail" onChange=${(e) => { addOuv(e.target.value); e.target.value = ''; }}>
      <option value="">+ Autre travail…</option>
      ${ouvrages.map((o) => html`<option value=${o.id}>${o.nom}</option>`)}
    </select>
    <div class="row">
      <button type="button" class="btn ghost sm" onClick=${() => update(() => {
        const n = JSON.parse(JSON.stringify(p)); n.id = uid(); n.nom = p.nom ? p.nom + ' (copie)' : ''; n.lignes.forEach((l) => { l.id = uid(); });
        d.pieces.splice(i + 1, 0, n);
      })}>Copier la pièce</button>
      <${ConfirmBtn} cls="sm ghost" label="Supprimer la pièce" onConfirm=${() => update(() => { d.pieces = d.pieces.filter((x) => x !== p); })} />
    </div>
  </div>`;
}

/* ---------------------------------------------------------- Document client */
function DocClient({ d, onBack, go }) {
  const c = calcDevis(d);
  const e = state.settings.entreprise;
  const s = state.settings;
  const manque = [!e.nom && 'le nom de votre entreprise', !e.adresse && 'votre adresse', !e.siret && 'votre SIRET', !e.assurance && 'votre assurance décennale'].filter(Boolean);
  return html`<div class="section">
    <div class="doc-bar no-print">
      <button type="button" class="btn ghost" onClick=${onBack}>${Icon.back} Retour au devis</button>
      <button type="button" class="btn primary big" onClick=${() => { try { window.print(); } catch (err) {} }}>Enregistrer en PDF</button>
    </div>
    ${manque.length ? html`<div class="banner warn no-print"><span>Il manque sur ce devis : ${manque.join(', ')}.</span><button type="button" class="btn sm" onClick=${() => go('reglages')}>Compléter maintenant</button></div>` : null}
    <div class="banner info no-print"><span>Touchez « Enregistrer en PDF », puis choisissez <b>Enregistrer en PDF</b> (ou « Imprimer » → « Partager » sur iPhone) pour l'envoyer au client.</span></div>
    <article class="doc">
      <div class="dh">
        <div class="ent">
          <b>${e.nom || 'Votre entreprise'}</b><br />
          ${e.adresse ? html`${e.adresse}<br />` : null}${e.cp || e.ville ? html`${e.cp} ${e.ville}<br />` : null}
          ${e.tel ? html`Tél. ${e.tel}<br />` : null}${e.email ? html`${e.email}<br />` : null}
          ${e.siret ? html`SIRET ${e.siret}` : null}
        </div>
        <div class="dref">
          <h1>Devis</h1>
          <div>N° <b>${d.numero}</b></div>
          <div>Date : ${dateFr(d.date)}</div>
          <div>Valable jusqu'au ${dateFr(addDays(d.date, num(s.validite) || 30))}</div>
        </div>
      </div>
      <div class="boxes">
        <div class="box"><div class="t">Client</div><b>${d.client.nom}</b>${d.client.adresse ? html`<br />${d.client.adresse}` : null}${d.client.tel ? html`<br />${d.client.tel}` : null}${d.client.email ? html`<br />${d.client.email}` : null}</div>
        <div class="box"><div class="t">Chantier</div>${d.chantier || d.client.adresse || '—'}<br /><b>${d.objet}</b></div>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Désignation</th><th class="n">Qté</th><th>U</th><th class="n">PU HT</th><th class="n">Total HT</th></tr></thead>
        <tbody>
          ${c.pieces.filter((p) => p.lignes.some((x) => x.c.qte > 0)).map((p) => html`
            <tr class="grp"><td colspan="5">${p.piece.nom}</td></tr>
            ${p.lignes.filter((x) => x.c.qte > 0).map(({ ligne: l, c: lc }) => html`<tr>
              <td>${l.ouvrage.nom}</td><td class="n">${fmt(lc.qte, 2)}</td><td>${lc.unite}</td><td class="n">${eur(lc.pu)}</td><td class="n">${eur(lc.vente)}</td></tr>`)}
          `)}
          ${d.divers.filter((x) => num(x.vente)).length ? html`<tr class="grp"><td colspan="5">Divers</td></tr>
            ${d.divers.filter((x) => num(x.vente)).map((x) => html`<tr><td>${x.designation}</td><td class="n">1</td><td>forfait</td><td class="n">${eur(num(x.vente))}</td><td class="n">${eur(num(x.vente))}</td></tr>`)}` : null}
        </tbody>
      </table></div>
      <div class="totals">
        ${c.remise ? html`<span>Sous-total HT</span><span class="n">${eur(c.sousTotal)}</span><span>Remise ${fmt(d.remisePct)} %</span><span class="n">− ${eur(c.remise)}</span>` : null}
        <span>Total HT</span><span class="n">${eur(c.totalHT)}</span>
        <span>TVA ${fmt(d.params.tva)} %</span><span class="n">${eur(c.tva)}</span>
        <span class="big">Total TTC</span><span class="n big">${eur(c.ttc)}</span>
      </div>
      <div class="legal">
        ${num(s.acompte) ? html`<p>Acompte de ${fmt(s.acompte)} % à la signature, soit ${eur(c.ttc * num(s.acompte) / 100)} TTC. Solde à la fin des travaux.</p>` : null}
        ${num(d.params.tva) === 10 ? html`<p>TVA au taux réduit de 10 % : le client atteste que les travaux sont réalisés dans un logement achevé depuis plus de deux ans.</p>` : null}
        ${e.assurance ? html`<p>Assurance décennale : ${e.assurance}</p>` : null}
        ${e.mentions ? html`<p>${e.mentions}</p>` : null}
        <p>Devis gratuit. Les fournitures sont comprises dans les prix indiqués.</p>
      </div>
      <div class="sign">
        <div class="box"><div class="t">L'entreprise</div></div>
        <div class="box"><div class="t">Bon pour accord — date et signature du client</div></div>
      </div>
    </article>
  </div>`;
}

function Courses({ d, onBack }) {
  const c = calcDevis(d);
  const texte = `Courses – ${d.client.nom}\n` + c.courses.map((e) => `- ${e.nb} × ${e.produit.nom} (${fmt(e.produit.contenance)} ${e.produit.unite})`).join('\n');
  const copier = () => {
    try { navigator.clipboard.writeText(texte).then(() => toast('Liste copiée : collez-la dans un SMS ou un mail'), () => toast('Copie impossible')); } catch (e) { toast('Copie impossible'); }
  };
  return html`<div class="section">
    <div class="doc-bar no-print">
      <button type="button" class="btn ghost" onClick=${onBack}>${Icon.back} Retour au devis</button>
      <div class="row"><button type="button" class="btn primary" onClick=${copier}>Copier la liste</button>
      <button type="button" class="btn" onClick=${() => { try { window.print(); } catch (err) {} }}>Imprimer</button></div>
    </div>
    <article class="doc">
      <div class="dh"><div><h1>Liste de courses</h1><div>${d.client.nom} · ${d.objet}</div></div>
        <div class="dref"><div>Perte de produit comprise : ${pct(num(d.params.pertes), 0)}</div><div>${fmt(c.heures, 1)} h de travail prévues</div></div></div>
      ${c.courses.length ? html`<div class="tbl-wrap"><table>
        <thead><tr><th>Produit</th><th class="n">À acheter</th><th class="n">Besoin</th><th class="n">Coût HT</th></tr></thead>
        <tbody>${c.courses.map((e) => html`<tr>
          <td>${e.produit.nom}</td><td class="n"><b>${e.nb} × ${fmt(e.produit.contenance)} ${e.produit.unite}</b></td><td class="n">${fmt(e.besoin, 1)} ${e.produit.unite}</td>
          <td class="n">${eur(e.cout)}</td></tr>`)}</tbody>
      </table></div>
      <div class="totals"><span class="big">Total produits HT</span><span class="n big">${eur(c.coutFourn)}</span></div>` : html`<p>Aucun produit : ajoutez des travaux au devis.</p>`}
    </article>
  </div>`;
}

/* ---------------------------------------------------------- Produits */
function setPrix(p, v) {
  if (v == null || num(v) === num(p.prix)) return false;
  update(() => {
    p.historique = [...(p.historique || []), { date: p.maj, prix: p.prix }].slice(-20);
    p.prix = num(v); p.maj = today(); p.exemple = false;
  });
  return true;
}
const CONTENANTS = { L: 'Pot', kg: 'Sac', 'm²': 'Rouleau', ml: 'Rouleau', rouleau: '', pièce: '', lot: 'Lot' };
function condLabel(p) {
  if (num(p.contenance) === 1 && ['rouleau', 'pièce', 'lot'].includes(p.unite)) return '1 ' + p.unite;
  return ((CONTENANTS[p.unite] ?? '') + ' ' + fmt(p.contenance) + ' ' + p.unite).trim();
}
function Produits() {
  const s = state;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(null);
  const [outil, setOutil] = useState(false);
  const fileRef = useRef();
  const cats = [...new Set([...CATEGORIES.filter((c) => s.produits.some((p) => p.categorie === c)), ...s.produits.map((p) => p.categorie)])];
  const enCours = open && s.produits.find((p) => p.id === open);
  const list = s.produits.filter((p) => p.id !== open && (!cat || p.categorie === cat) && (!q || norm(p.nom + ' ' + (p.ref || '') + ' ' + (p.fournisseur || '')).includes(norm(q))));
  const groupes = cats.map((c) => [c, list.filter((p) => p.categorie === c)]).filter(([, l]) => l.length);
  const vieux = s.produits.filter((p) => ageDays(p.maj) > 180).length;
  const nouveau = () => {
    const p = { id: uid(), nom: '', categorie: cat || 'Peinture', unite: 'L', contenance: 1, prix: 0, rendement: null, fournisseur: '', ref: '', maj: today(), historique: [] };
    update((s) => { s.produits.unshift(p); });
    setQ(''); setOpen(p.id);
  };
  const fermer = () => {
    const p = enCours;
    if (p && !p.nom.trim() && !num(p.prix)) update((s) => { s.produits = s.produits.filter((x) => x !== p); });
    setOpen(null);
  };
  const onImport = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const r = importProduitsCSV(await readFile(f));
      let msg = `${r.maj} produit(s) mis à jour, ${r.ajout} ajouté(s)`;
      if (r.ignores) msg += `, ${r.ignores} ligne(s) sans prix ignorée(s)`;
      if (r.ambigus) msg += `, ${r.ambigus} ignorée(s) car plusieurs produits ont le même nom`;
      toast(msg);
    } catch (err) { toast(err.message); }
  };

  return html`<section class="section">
    <div class="section-head">
      <h1>Produits</h1>
      <div class="row">
        <button type="button" class="btn" onClick=${() => setOutil(!outil)}>Hausse de prix</button>
        <button type="button" class="btn primary" onClick=${nouveau}>${Icon.plus} Nouveau produit</button>
      </div>
    </div>
    ${s.produits.some((p) => p.exemple) ? html`<div class="banner warn"><span>Les prix ci-dessous sont des exemples : touchez un prix pour mettre le vôtre.</span></div>` : null}
    ${vieux ? html`<div class="banner warn"><span>${vieux} prix n'ont pas été vérifiés depuis plus de 6 mois.</span></div>` : null}
    ${outil ? html`<${OutilPrix} onImport=${() => fileRef.current.click()} />` : null}
    <input ref=${fileRef} type="file" accept=".csv,text/csv" hidden onChange=${onImport} />
    ${enCours ? html`<${ProduitEdit} key=${enCours.id} p=${enCours} onClose=${fermer} />` : null}
    <div class="row">
      <div class="grow" style="flex-basis:220px"><input id="q-prod" type="search" placeholder="Chercher un produit…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      ${expert() ? html`<select id="f-cat" style="width:auto" value=${cat} onChange=${(e) => setCat(e.target.value)}>
        <option value="">Toutes catégories</option>${cats.map((c) => html`<option value=${c}>${c}</option>`)}
      </select>` : null}
    </div>
    <div class="card">
      ${groupes.length === 0 ? html`<div class="empty">Aucun produit.</div>` : groupes.map(([c, l]) => html`
        <div class="cat-title">${c}</div>
        <div class="plist">${l.map((p) => html`<div class="prow" key=${p.id}>
            <div class="grow">
              <button type="button" class="pn" onClick=${() => setOpen(p.id)}>${p.nom || 'Produit sans nom'}</button>
              <div class="pm"><span>${condLabel(p)}${num(p.contenance) && num(p.contenance) !== 1 ? ' · ' + eur(num(p.prix) / num(p.contenance)) + '/' + p.unite : ''}</span>
                ${ageDays(p.maj) > 180 ? html`<span class="old">prix du ${dateFr(p.maj)}, à vérifier</span>` : null}</div>
            </div>
            <${NumIn} id=${'pp-' + p.id} value=${p.prix} suffix="€" onCommit=${(v) => { const ancien = p.prix; if (setPrix(p, v)) toast('Prix enregistré (avant : ' + eur(num(ancien)) + ')'); }} />
          </div>`)}</div>`)}
    </div>
    <p class="hint">Touchez un prix pour le changer : l'ancien est gardé. Les devis déjà envoyés ne changent pas.</p>
  </section>`;
}

function OutilPrix({ onImport }) {
  const s = state;
  const [taux, setTaux] = useState(null);
  const [sens, setSens] = useState(1);
  const [cat, setCat] = useState('');
  const [four, setFour] = useState('');
  const fours = [...new Set(s.produits.map((p) => p.fournisseur).filter(Boolean))];
  const cible = s.produits.filter((p) => (!cat || p.categorie === cat) && (!four || p.fournisseur === four));
  const appliquer = () => {
    if (!num(taux)) return;
    const t = sens * Math.abs(num(taux));
    update(() => { for (const p of cible) { p.historique = [...(p.historique || []), { date: p.maj, prix: p.prix }].slice(-20); p.prix = round2(num(p.prix) * (1 + t / 100)); p.maj = today(); p.exemple = false; } });
    toast(`${cible.length} prix mis à jour`); setTaux(null);
  };
  return html`<div class="card">
    <span class="tape">Changer plusieurs prix d'un coup</span>
    <div class="chips"><button type="button" class=${'chip big' + (sens > 0 ? ' on' : '')} onClick=${() => setSens(1)}>Hausse</button><button type="button" class=${'chip big' + (sens < 0 ? ' on' : '')} onClick=${() => setSens(-1)}>Baisse</button></div>
    <div class="fields">
      <${Field} label="De combien ?"><${NumIn} id="op-t" value=${taux} placeholder="ex. 4,5" suffix="%" onSet=${setTaux} /><//>
      ${fours.length > 1 ? html`<${Field} label="Chez quel fournisseur ?"><select id="op-f" value=${four} onChange=${(e) => setFour(e.target.value)}><option value="">Tous</option>${fours.map((f) => html`<option value=${f}>${f}</option>`)}</select><//>` : null}
      <${Field} label="Quels produits ?"><select id="op-c" value=${cat} onChange=${(e) => setCat(e.target.value)}><option value="">Tous</option>${[...new Set(s.produits.map((p) => p.categorie))].map((c) => html`<option value=${c}>${c}</option>`)}</select><//>
    </div>
    <div><button type="button" class="btn primary" disabled=${!num(taux)} onClick=${appliquer}>${sens > 0 ? 'Augmenter' : 'Baisser'} ${cible.length} prix</button></div>
    ${expert() ? html`<span class="tape">Avec Excel</span>
    <p class="small">Exportez la liste, modifiez les prix dans Excel ou LibreOffice, puis importez le fichier : les produits sont reconnus et les nouveaux sont ajoutés.</p>
    <div class="row">
      <button type="button" class="btn" onClick=${() => { if (!download('produits-' + today() + '.csv', produitsCSV(), 'text/csv;charset=utf-8')) toast('Téléchargement impossible ici'); }}>Exporter la liste (.csv)</button>
      <button type="button" class="btn" onClick=${onImport}>Importer un fichier (.csv)</button>
    </div>` : null}
  </div>`;
}

function ProduitEdit({ p, onClose }) {
  const [plus, setPlus] = useState(false);
  const set = (fn) => update(() => { fn(p); p.exemple = false; });
  const used = state.ouvrages.filter((o) => o.fournitures.some((f) => f.produitId === p.id));
  const autres = state.ouvrages.filter((o) => !used.includes(o));
  return html`<div class="card edit-card">
    <div class="fields">
      <${Field} label="Nom du produit" wide><${TextIn} id=${'pe-n-' + p.id} value=${p.nom} placeholder="Ex. Peinture velours blanc 15 L" onSet=${(v) => set((p) => { p.nom = v; })} /><//>
      <${Field} label="Vendu par"><input id=${'pe-u-' + p.id} type="text" list="unites" value=${p.unite} onInput=${(e) => set((p) => { p.unite = e.target.value; })} /><//>
      <${Field} label=${'Taille du pot / sac (en ' + (p.unite || 'unités') + ')'} hint=${'Ex. 15 pour un pot de 15 ' + p.unite}><${NumIn} id=${'pe-ct-' + p.id} value=${p.contenance} onSet=${(v) => set((p) => { p.contenance = v; })} /><//>
      <${Field} label="Prix d'achat HT"><${NumIn} id=${'pe-p-' + p.id} value=${p.prix} suffix="€" onCommit=${(v) => setPrix(p, v)} /><//>
      <${Field} label=${'m² couverts avec 1 ' + (p.unite || 'unité')} hint="Pour une couche (voir la fiche du produit)"><${NumIn} id=${'pe-r-' + p.id} value=${p.rendement} placeholder="ex. 10" onSet=${(v) => set((p) => { p.rendement = v; })} /><//>
      <${Field} label="Rangé dans"><input id=${'pe-c-' + p.id} type="text" list="cats" value=${p.categorie} onInput=${(e) => set((p) => { p.categorie = e.target.value; })} /><//>
      ${plus ? html`
        <${Field} label="Fournisseur"><${TextIn} id=${'pe-f-' + p.id} value=${p.fournisseur} onSet=${(v) => set((p) => { p.fournisseur = v; })} /><//>
        <${Field} label="Référence"><${TextIn} id=${'pe-ref-' + p.id} value=${p.ref} onSet=${(v) => set((p) => { p.ref = v; })} /><//>` : null}
    </div>
    ${!plus ? html`<div><button type="button" class="btn ghost sm" onClick=${() => setPlus(true)}>+ Fournisseur, référence</button></div>` : null}
    ${p.historique && p.historique.length ? html`<div class="hist"><span class="lab">Anciens prix</span>
      ${[...p.historique].reverse().map((h) => html`<span>${dateFr(h.date)} : ${eur(num(h.prix))}</span>`)}<span>${dateFr(p.maj)} : <b>${eur(num(p.prix))}</b> (actuel)</span></div>` : null}
    ${used.length ? html`<p class="hint">Utilisé dans : ${used.map((o) => o.nom).join(', ')}</p>`
      : html`<div class="banner warn"><span>Ce produit n'est utilisé dans aucun travail : il ne sera pas compté dans les devis.</span>
        ${autres.length ? html`<select id=${'pe-use-' + p.id} style="width:auto" onChange=${(e) => { const o = ouvById(e.target.value); if (o) { update(() => { o.fournitures.push({ produitId: p.id, couches: 1, conso: null }); }); toast('Ajouté à « ' + o.nom + ' »'); } e.target.value = ''; }}>
          <option value="">L'ajouter à un travail…</option>${autres.map((o) => html`<option value=${o.id}>${o.nom}</option>`)}</select>` : null}</div>`}
    <div class="row between">
      <button type="button" class="btn primary big" onClick=${onClose}>Terminé</button>
      <${ConfirmBtn} label="Supprimer" confirm=${used.length ? 'Supprimer (et retirer des travaux) ?' : 'Supprimer ?'} onConfirm=${() => {
        update((s) => { s.produits = s.produits.filter((x) => x.id !== p.id); s.ouvrages.forEach((o) => { o.fournitures = o.fournitures.filter((f) => f.produitId !== p.id); }); });
        onClose();
      }} />
    </div>
    <datalist id="cats">${CATEGORIES.map((c) => html`<option value=${c}></option>`)}</datalist>
    <datalist id="unites">${UNITES.map((c) => html`<option value=${c}></option>`)}</datalist>
  </div>`;
}

/* ---------------------------------------------------------- Travaux (ouvrages) */
const parSurface = (base) => ['murs', 'plafond', 'sol', 'perimetre'].includes(base);
function Ouvrages() {
  const s = state;
  const [open, setOpen] = useState(null);
  const o = open && s.ouvrages.find((x) => x.id === open);
  if (o) return html`<${OuvrageEdit} o=${o} onClose=${() => setOpen(null)} />`;
  const nouveau = () => {
    const n = { id: uid(), nom: '', base: 'murs', temps: 0.1, fournitures: [] };
    update((s) => { s.ouvrages.push(n); });
    setOpen(n.id);
  };
  return html`<section class="section">
    <div class="section-head"><h1>Travaux</h1><button type="button" class="btn primary" onClick=${nouveau}>${Icon.plus} Nouveau travail</button></div>
    <p class="muted">Ici, vous réglez votre façon de chiffrer : pour chaque travail, combien de m² vous faites en une heure et quels produits il faut. Le prix se calcule ensuite tout seul dans les devis.</p>
    <div class="olist">${s.ouvrages.map((o) => {
      const c = calcOuvrageIndicatif(o, s.settings);
      const u = BASES[o.base]?.unite;
      return html`<button type="button" class="card oitem" key=${o.id} onClick=${() => setOpen(o.id)}>
        <div style="font-weight:600">${o.nom || 'Travail sans nom'}</div>
        <div class="op"><span class="muted small">${parSurface(o.base) && num(o.temps) ? fmt(1 / num(o.temps), 1) + ' ' + u + ' à l\'heure' : fmt(o.temps, 2) + ' h par ' + u}</span><span class="opv">${eur(c.vente)}<span class="small muted"> /${u}</span></span></div>
        <div class="muted small">${o.fournitures.length ? o.fournitures.map((f) => prodById(f.produitId)?.nom).filter(Boolean).join(' · ') : 'Main d\'œuvre seule'}</div>
      </button>`;
    })}</div>
  </section>`;
}

function OuvrageEdit({ o, onClose }) {
  const s = state;
  const set = (fn) => update(() => { fn(o); o.exemple = false; });
  const c = calcOuvrageIndicatif(o, s.settings);
  const u = BASES[o.base]?.unite;
  const prods = s.produits.slice().sort((a, b) => a.categorie.localeCompare(b.categorie) || a.nom.localeCompare(b.nom));
  const couchesUtiles = (p) => p && (p.unite === 'L' || ['Peinture', 'Sous-couche'].includes(p.categorie));
  return html`<section class="section">
    <div class="row between"><button type="button" class="btn ghost" onClick=${onClose}>${Icon.back} Tous les travaux</button></div>
    <div class="card">
      <div class="fields">
        <${Field} label="Nom (écrit sur le devis)" wide><${TextIn} id="oe-n" value=${o.nom} placeholder="Ex. Peinture murs 2 couches" onSet=${(v) => set((o) => { o.nom = v; })} /><//>
        <${Field} label="Se calcule sur"><select id="oe-b" value=${o.base} onChange=${(e) => set((o) => { o.base = e.target.value; })}>${Object.entries(BASES).map(([k, b]) => html`<option value=${k}>${b.label}</option>`)}</select><//>
        ${parSurface(o.base)
          ? html`<${Field} label=${u + ' faits en 1 heure'} hint="Votre vitesse moyenne, préparation comprise"><${NumIn} id="oe-v" value=${num(o.temps) ? round2(1 / num(o.temps)) : null} suffix=${u + '/h'} onSet=${(v) => set((o) => { o.temps = v > 0 ? 1 / v : 0; })} /><//>`
          : html`<${Field} label=${'Heures par ' + (u === 'u' ? 'pièce' : u)}><${NumIn} id="oe-t" value=${o.temps} suffix="h" onSet=${(v) => set((o) => { o.temps = v; })} /><//>`}
      </div>
    </div>
    <div class="card">
      <span class="tape">Produits utilisés</span>
      ${o.fournitures.length ? null : html`<p class="muted">Aucun produit : seulement du temps de travail.</p>`}
      ${o.fournitures.map((f, i) => {
        const p = prodById(f.produitId);
        const auto = p && num(p.rendement) ? (hasVal(f.couches) ? num(f.couches) : 1) / num(p.rendement) : null;
        const manque = auto == null && !hasVal(f.conso);
        return html`<div class="frow" key=${i}>
          <${Field} label="Produit"><select id=${'of-p-' + i} value=${f.produitId} onChange=${(e) => set(() => { f.produitId = e.target.value; })}>
            ${prods.map((x) => html`<option value=${x.id}>${x.nom}</option>`)}</select><//>
          ${couchesUtiles(p) ? html`<${Field} label="Couches"><${NumIn} id=${'of-c-' + i} value=${f.couches} onSet=${(v) => set(() => { f.couches = v; })} /><//>` : html`<span></span>`}
          ${expert() || manque || hasVal(f.conso) ? html`<${Field} label=${(p ? p.unite : '') + ' par ' + u}><${NumIn} id=${'of-q-' + i} value=${f.conso} placeholder=${auto != null ? fmt(auto, 3) : 'à remplir'} onSet=${(v) => set(() => { f.conso = v; })} /><//>` : html`<span></span>`}
          <button type="button" class="x" aria-label="Retirer le produit" onClick=${() => set((o) => { o.fournitures.splice(i, 1); })}>×</button>
          ${manque ? html`<p class="small mg-bad" style="grid-column:1/-1">On ne sait pas combien en mettre : indiquez les m² couverts dans la fiche du produit, ou la quantité par ${u} ici.</p>` : null}
        </div>`;
      })}
      <div><button type="button" class="btn" disabled=${!prods.length} onClick=${() => set((o) => { o.fournitures.push({ produitId: prods[0].id, couches: 1, conso: null }); })}>${Icon.plus} Ajouter un produit</button></div>
    </div>
    <div class="card">
      <span class="tape">Ce que ça donne</span>
      <div class="kpis">
        <div class="kpi"><span class="k">Prix pour le client</span><span class="v">${eur(c.vente)}</span><span class="s">HT par ${u}</span></div>
        <div class="kpi"><span class="k">Produits</span><span class="v">${eur(c.coutFourn)}</span><span class="s">prix d'achat par ${u}</span></div>
        <div class="kpi"><span class="k">Votre bénéfice</span><span class="v">${pct(c.vente ? c.marge / c.vente : 0, 0)}</span><span class="s">${eur(c.marge)} par ${u}</span></div>
      </div>
      <p class="hint">Avec vos réglages : ${eur0(s.settings.tauxHoraire)} de l'heure, ${pct(num(s.settings.coefFournitures) - 1, 0)} de marge sur les produits.</p>
    </div>
    <div class="row between">
      <div class="row">
        <button type="button" class="btn primary big" onClick=${onClose}>Terminé</button>
        <button type="button" class="btn" onClick=${() => { update((s) => { s.ouvrages.push({ ...JSON.parse(JSON.stringify(o)), id: uid(), nom: o.nom + ' (copie)' }); }); toast('Travail copié'); }}>Faire une copie</button>
      </div>
      <${ConfirmBtn} label="Supprimer" onConfirm=${() => { update((s) => { s.ouvrages = s.ouvrages.filter((x) => x.id !== o.id); }); onClose(); }} />
    </div>
  </section>`;
}

/* ---------------------------------------------------------- Bilan / retour d'expérience */
function Bilan({ onOpen }) {
  const s = state;
  const [periode, setPeriode] = useState('tout');
  const [voirDetail, setVoirDetail] = useState(false);
  const lim = periode === '12m' ? daysAgo(365) : periode === 'annee' ? new Date().getFullYear() + '-01-01' : '';
  const ds = s.devis.filter((d) => !lim || d.date >= lim).map((d) => ({ d, c: calcDevis(d) }));
  const acc = ds.filter((x) => x.d.statut === 'accepte');
  const ref = ds.filter((x) => x.d.statut === 'refuse');
  const env = ds.filter((x) => x.d.statut === 'envoye');
  const decides = acc.length + ref.length;
  const ca = sum(acc, (x) => x.c.signe);
  const mAcc = acc.map((x) => x.c.margeSigneePct);
  const mRef = ref.map((x) => x.c.margePct);
  const moyAcc = avg(mAcc), moyRef = avg(mRef);
  const nego = avg(acc.map((x) => x.c.negociation));
  const rex = acc.filter((x) => x.c.rexSaisi);
  const ecartH = avg(rex.filter((x) => x.c.heuresReelles != null && x.c.heures > 0).map((x) => x.c.heuresReelles / x.c.heures - 1));
  const moyReelle = avg(rex.map((x) => x.c.margeReellePct));
  const minAcc = mAcc.length ? Math.min(...mAcc) : null, maxAcc = mAcc.length ? Math.max(...mAcc) : null;
  const mini = num(s.settings.margeMini);
  const taux = decides ? acc.length / decides : null;

  // Prix au m² par travail, signés et refusés
  const parOuv = new Map();
  for (const { d, c } of [...acc, ...ref]) {
    const k = c.sousTotal > 0 ? (d.statut === 'accepte' ? c.signe : c.totalHT) / c.sousTotal : 1;
    for (const p of c.pieces) for (const { ligne: l, c: lc } of p.lignes) {
      if (!lc.qte || l.ouvrage.base === 'forfait') continue;
      const cle = l.ouvrage.nom + '|' + lc.unite;
      const e = parOuv.get(cle) || { nom: l.ouvrage.nom, unite: lc.unite, acc: { q: 0, v: 0 }, ref: { q: 0, v: 0 } };
      const t = d.statut === 'accepte' ? e.acc : e.ref;
      t.q += lc.qte; t.v += lc.vente * k;
      parOuv.set(cle, e);
    }
  }
  const ouvRows = [...parOuv.values()].sort((a, b) => b.acc.v + b.ref.v - (a.acc.v + a.ref.v));

  // Conseils, du plus important au moins important : on n'en montre que 2
  const conseils = [];
  if (ecartH != null && ecartH > 0.04) conseils.push(html`Vos chantiers prennent <b>${pct(ecartH, 0)} de temps en plus</b> que prévu. Dans « Travaux », baissez un peu les m² faits à l'heure pour ne pas travailler gratuitement.`);
  const sousMini = mAcc.filter((m) => m < mini).length;
  if (sousMini) conseils.push(html`<b>${sousMini} devis signé${sousMini > 1 ? 's' : ''}</b> vous ${sousMini > 1 ? 'ont' : 'a'} rapporté moins de ${pct(mini, 0)} de bénéfice. En négociation, ne descendez pas sous le prix mini affiché dans le devis.`);
  if (nego != null && nego > 0.02) conseils.push(html`Vos clients obtiennent en moyenne <b>${pct(nego, 0)} de remise</b>. Pensez-y dans votre prix de départ.`);
  if (moyRef != null && moyAcc != null && moyRef > moyAcc + 0.05) conseils.push(html`Vos devis refusés étaient plus chers (bénéfice ${pct(moyRef, 0)} contre ${pct(moyAcc, 0)}) : le prix a sans doute joué.`);
  if (taux != null && decides >= 3 && taux > 0.8) conseils.push(html`Vous signez presque tout : vous pouvez sans doute monter un peu vos prix.`);
  if (ecartH != null && ecartH < -0.04) conseils.push(html`Vous allez plus vite que prévu (${pct(-ecartH, 0)} de temps en moins) : bonne nouvelle pour votre bénéfice.`);

  // Échelle des bénéfices
  const all = [...mAcc, ...mRef];
  const hi = Math.max(0.5, Math.ceil((Math.max(0, ...all) + 0.05) * 10) / 10);
  const lo = Math.min(0, Math.floor(Math.min(0, ...all) * 10) / 10);
  const pos = (v) => ((v - lo) / (hi - lo)) * 100;
  const ticks = []; for (let t = lo; t <= hi + 1e-9; t += 0.1) ticks.push(round2(t));

  if (!decides) return html`<section class="section"><h1>Bilan</h1>
    <div class="card empty"><p>Le bilan se remplit tout seul quand vous indiquez si vos devis sont <b>signés</b> ou <b>refusés</b> (en haut de chaque devis).</p></div></section>`;

  return html`<section class="section">
    <h1>Bilan</h1>
    ${s.devis.some((d) => d.exemple) ? html`<div class="banner info"><span>Ce bilan compte aussi les devis d'exemple.</span></div>` : null}
    <div class="card headline">
      <p>Vous signez <b>${acc.length} devis sur ${decides}</b>${env.length ? html`, et ${env.length} attend${env.length > 1 ? 'ent' : ''} une réponse` : ''}.</p>
      ${moyAcc != null ? html`<p>Sur un chantier signé, vous gagnez en moyenne <b class=${margeClass(moyAcc, mini)}>${pct(moyAcc, 0)}</b> du prix${moyReelle != null ? html` (<b>${pct(moyReelle, 0)}</b> en vrai, une fois le chantier fini)` : ''}.</p>` : null}
      ${nego != null ? html`<p>Vos clients obtiennent <b>${pct(nego, 0)}</b> de remise en moyenne.</p>` : null}
      <p class="muted">Chiffre signé : ${eur0(ca)} HT</p>
    </div>
    ${conseils.length ? html`<div class="card"><span class="tape">À retenir</span><ul class="advice">${conseils.slice(0, 2).map((t) => html`<li>${t}</li>`)}</ul></div>` : null}

    <div><button type="button" class="btn" onClick=${() => setVoirDetail(!voirDetail)}>${voirDetail ? 'Masquer le détail' : 'Voir le détail (prix au m², chantiers)'}</button></div>
    ${voirDetail ? html`
      <div class="chips">${[['tout', 'Tout'], ['12m', '12 derniers mois'], ['annee', 'Cette année']].map(([k, l]) => html`<button type="button" class=${'chip' + (periode === k ? ' on' : '')} onClick=${() => setPeriode(k)}>${l}</button>`)}</div>
      ${all.length ? html`<div class="card">
        <span class="tape">Bénéfice de chaque devis</span>
        <div class="scale" role="img" aria-label="Bénéfice de chaque devis signé ou refusé">
          <div class="axis"></div>
          ${minAcc != null ? html`<div class="band" style=${`left:${pos(minAcc)}%;width:${Math.max(1, pos(maxAcc) - pos(minAcc))}%`}></div>` : null}
          ${ticks.map((t) => html`<span class="tick" style=${`left:${pos(t)}%`}>${Math.round(t * 100)}%</span>`)}
          ${ref.map((x) => html`<span class="dot ref" style=${`left:${pos(x.c.margePct)}%`}></span>`)}
          ${acc.map((x) => html`<span class="dot acc" style=${`left:${pos(x.c.margeSigneePct)}%`}></span>`)}
        </div>
        <div class="legend"><span><i style="background:var(--ok)"></i>Signé</span><span><i style="background:var(--bad)"></i>Refusé</span><span><i style="background:var(--ok-soft)"></i>Ce que vos clients acceptent</span></div>
      </div>` : null}
      ${ouvRows.length ? html`<div class="card">
        <span class="tape">Vos prix par travail</span>
        <div class="tbl-wrap"><table class="tbl cards">
          <thead><tr><th>Travail</th><th class="n">Prix signé</th><th class="n">Prix refusé</th></tr></thead>
          <tbody>${ouvRows.map((r) => html`<tr>
            <td>${r.nom}</td>
            <td class="n" data-label="Signé">${r.acc.q ? eur(r.acc.v / r.acc.q) + '/' + r.unite : '–'}</td>
            <td class="n" data-label="Refusé">${r.ref.q ? eur(r.ref.v / r.ref.q) + '/' + r.unite : '–'}</td></tr>`)}</tbody>
        </table></div>
        <p class="hint">Prix moyen HT vraiment facturé, remises comprises.</p>
      </div>` : null}
      ${acc.length ? html`<div class="card">
        <span class="tape">Chantiers signés</span>
        <div class="tbl-wrap"><table class="tbl cards">
          <thead><tr><th>Client</th><th class="n">Signé HT</th><th class="n">Heures prévues / vraies</th><th class="n">Bénéfice prévu</th><th class="n">Bénéfice vrai</th></tr></thead>
          <tbody>${acc.slice().sort((a, b) => b.d.date.localeCompare(a.d.date)).map(({ d, c }) => html`<tr style="cursor:pointer" onClick=${() => onOpen(d.id)}>
            <td><b>${d.client.nom}</b><div class="muted small">${dateFr(d.date)}</div></td>
            <td class="n" data-label="Signé HT">${eur0(c.signe)}</td>
            <td class="n" data-label="Heures prévues / vraies">${fmt(c.heures, 0)} h / ${c.heuresReelles != null ? fmt(c.heuresReelles, 0) + ' h' : '–'}</td>
            <td class="n" data-label="Bénéfice prévu">${pct(c.margeSigneePct, 0)}</td>
            <td class="n" data-label="Bénéfice vrai">${c.rexSaisi ? html`<b class=${margeClass(c.margeReellePct, mini)}>${pct(c.margeReellePct, 0)}</b>` : html`<span class="muted">à remplir</span>`}</td></tr>`)}</tbody>
        </table></div>
        <p class="hint">Touchez un chantier pour noter le temps passé en vrai.</p>
      </div>` : null}` : null}
  </section>`;
}

/* ---------------------------------------------------------- Réglages */
function Reglages() {
  const s = state;
  const st = s.settings;
  const e = st.entreprise;
  const set = (fn) => update(() => fn(st));
  const fileRef = useRef();
  const [copie, setCopie] = useState(false);
  const onRestore = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try { importSauvegarde(await readFile(f)); toast('Sauvegarde restaurée'); } catch (err) { toast(err.message || 'Fichier illisible'); }
  };
  const copier = () => {
    const txt = exportSauvegarde();
    try { navigator.clipboard.writeText(txt).then(() => { marquerSauvegarde(); toast('Données copiées : collez-les dans un mail à vous-même'); }, () => setCopie(true)); } catch (err) { setCopie(true); }
  };
  const exemplesProduits = s.produits.some((p) => p.exemple) || s.ouvrages.some((o) => o.exemple);

  return html`<section class="section">
    <h1>Réglages</h1>
    <div class="card">
      <span class="tape">Mon entreprise (sur les devis)</span>
      <div class="fields">
        <${Field} label="Nom de l'entreprise" wide><${TextIn} id="e-nom" value=${e.nom} placeholder="Ex. Etienne Peinture" onSet=${(v) => set((st) => { st.entreprise.nom = v; })} /><//>
        <${Field} label="Adresse" wide><${TextIn} id="e-adr" value=${e.adresse} onSet=${(v) => set((st) => { st.entreprise.adresse = v; })} /><//>
        <${Field} label="Code postal"><${TextIn} id="e-cp" value=${e.cp} onSet=${(v) => set((st) => { st.entreprise.cp = v; })} /><//>
        <${Field} label="Ville"><${TextIn} id="e-ville" value=${e.ville} onSet=${(v) => set((st) => { st.entreprise.ville = v; })} /><//>
        <${Field} label="Téléphone"><${TextIn} id="e-tel" type="tel" value=${e.tel} onSet=${(v) => set((st) => { st.entreprise.tel = v; })} /><//>
        <${Field} label="E-mail"><${TextIn} id="e-mail" type="email" value=${e.email} onSet=${(v) => set((st) => { st.entreprise.email = v; })} /><//>
        <${Field} label="SIRET"><${TextIn} id="e-siret" value=${e.siret} onSet=${(v) => set((st) => { st.entreprise.siret = v; })} /><//>
        <${Field} label="Assurance décennale (obligatoire)" hint="Nom de l'assureur, n° de contrat, zone couverte" wide><${TextIn} id="e-ass" value=${e.assurance} onSet=${(v) => set((st) => { st.entreprise.assurance = v; })} /><//>
        ${expert() ? html`<${Field} label="Texte en bas de devis" wide><textarea id="e-ment" value=${e.mentions} onInput=${(ev) => set((st) => { st.entreprise.mentions = ev.target.value; })}></textarea><//>` : null}
      </div>
    </div>
    <div class="card">
      <span class="tape">Mes prix</span>
      <div class="fields">
        <${Field} label="Prix de l'heure pour le client"><${NumIn} id="s-th" value=${st.tauxHoraire} suffix="€/h" onSet=${(v) => set((st) => { st.tauxHoraire = v; })} /><//>
        <${Field} label="Ce que vous coûte une heure" hint="Charges, camion, assurance, votre salaire…"><${NumIn} id="s-ch" value=${st.coutHoraire} suffix="€/h" onSet=${(v) => set((st) => { st.coutHoraire = v; })} /><//>
        <${Field} label="TVA" hint="10 % en rénovation de logement"><${NumIn} id="s-tva" value=${st.tva} suffix="%" onSet=${(v) => set((st) => { st.tva = v; })} /><//>
        <${Field} label="Acompte à la signature"><${NumIn} id="s-ac" value=${st.acompte} suffix="%" onSet=${(v) => set((st) => { st.acompte = v; })} /><//>
        ${expert() ? html`
          <${Field} label="Marge sur les produits" hint="Ajoutée au prix d'achat des produits"><${NumIn} id="s-cf" value=${round2((num(st.coefFournitures) - 1) * 100)} suffix="%" onSet=${(v) => set((st) => { st.coefFournitures = 1 + num(v) / 100; })} /><//>
          <${Field} label="Perte de produit" hint="Fond de pot, rouleau, retouches"><${NumIn} id="s-pe" value=${round2(num(st.pertes) * 100)} suffix="%" onSet=${(v) => set((st) => { st.pertes = num(v) / 100; })} /><//>
          <${Field} label="Bénéfice minimum" hint="En dessous : prix mini dépassé"><${NumIn} id="s-mm" value=${round2(num(st.margeMini) * 100)} suffix="%" onSet=${(v) => set((st) => { st.margeMini = num(v) / 100; })} /><//>
          <${Field} label="Devis valable"><${NumIn} id="s-val" value=${st.validite} suffix="jours" onSet=${(v) => set((st) => { st.validite = v; })} /><//>
          <${Field} label="Prochain n° de devis"><${NumIn} id="s-num" value=${st.prochainNumero} onSet=${(v) => { if (v != null && v >= 1) set((st) => { st.prochainNumero = Math.round(v); }); }} /><//>` : null}
      </div>
      <label class="switch"><input id="s-expert" type="checkbox" checked=${!!st.expert} onChange=${(ev) => set((st) => { st.expert = ev.target.checked; })} /><span>Afficher les réglages avancés (marge produits, pertes, import Excel…)</span></label>
    </div>
    <div class="card">
      <span class="tape">Sauvegarde</span>
      <p>Vos devis sont gardés sur cet appareil seulement. Une fois par mois, envoyez-vous une sauvegarde (par mail ou WhatsApp).</p>
      <p class="muted small">Dernière sauvegarde : ${st.derniereSauvegarde ? dateFr(st.derniereSauvegarde) : 'jamais'}</p>
      <div class="row">
        <button type="button" class="btn primary big" onClick=${sauvegarder}>Sauvegarder maintenant</button>
        <button type="button" class="btn ghost" onClick=${copier}>Copier les données</button>
      </div>
      ${copie ? html`<textarea id="copie" readonly style="min-height:120px" onFocus=${(ev) => ev.target.select()} value=${JSON.stringify(state)}></textarea>` : null}
      <div class="row">
        <${ConfirmBtn} cls="plain" label="Récupérer une sauvegarde" confirm="Remplacer les données actuelles ?" onConfirm=${() => fileRef.current.click()} />
      </div>
      <input ref=${fileRef} type="file" accept=".json,application/json" hidden onChange=${onRestore} />
    </div>
    ${s.devis.some((d) => d.exemple) || exemplesProduits ? html`<div class="card">
      <span class="tape">Exemples</span>
      <div class="stack">
        ${s.devis.some((d) => d.exemple) ? html`<${ConfirmBtn} cls="plain" label="Supprimer les devis d'exemple (garder produits et travaux comme modèles)" confirm="Oui, supprimer les devis d'exemple" onConfirm=${() => { effacerExemples(); toast('Devis d\'exemple supprimés'); }} />` : null}
        <${ConfirmBtn} cls="plain" label="Partir de zéro : supprimer aussi les produits et travaux d'exemple" confirm="Oui, tout ce qui est exemple" onConfirm=${() => {
          update((s) => {
            s.devis = s.devis.filter((d) => !d.exemple);
            s.produits = s.produits.filter((p) => !p.exemple);
            const restants = new Set(s.produits.map((p) => p.id));
            s.ouvrages = s.ouvrages.filter((o) => !o.exemple);
            s.ouvrages.forEach((o) => { o.fournitures = o.fournitures.filter((f) => restants.has(f.produitId)); });
            if (!s.devis.length) s.settings.prochainNumero = 1;
          });
          toast('Exemples supprimés');
        }} />
      </div>
    </div>` : null}
    <div class="row" style="justify-content:flex-end">
      <${ConfirmBtn} cls="sm ghost" label="Réinitialiser l'appli (efface tout)" confirm="Vraiment tout effacer ?" onConfirm=${() => { state = seed(); save(); listeners.forEach((l) => l()); toast('Appli réinitialisée'); }} />
    </div>
  </section>`;
}

// Si un écran plante, on propose de quoi récupérer plutôt qu'une page blanche
function Root() {
  const [err, reset] = htmPreact.useErrorBoundary();
  if (err) {
    return html`<div class="shell"><div class="card">
      <h2>Un problème est survenu</h2>
      <p>Vos données ne sont pas effacées. Vous pouvez réessayer, télécharger vos données, ou revenir à la version d'avant la dernière restauration.</p>
      <p class="muted small">${String(err && err.message || err)}</p>
      <div class="row">
        <button type="button" class="btn primary" onClick=${reset}>Réessayer</button>
        <button type="button" class="btn" onClick=${() => download('metre-devis-secours-' + today() + '.json', JSON.stringify(state), 'application/json')}>Télécharger mes données</button>
        ${(() => { try { return localStorage.getItem(KEY + '.avant-restauration'); } catch (e) { return null; } })() ? html`<button type="button" class="btn" onClick=${() => {
          try { state = migrate(JSON.parse(localStorage.getItem(KEY + '.avant-restauration'))); save(); reset(); } catch (e) {}
        }}>Revenir avant la restauration</button>` : null}
      </div></div></div>`;
  }
  return html`<${App} />`;
}
render(html`<${Root} />`, document.getElementById('app'));
