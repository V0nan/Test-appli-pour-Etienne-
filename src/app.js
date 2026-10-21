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
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const hasVal = (v) => v != null && v !== '';
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : null);
const eur = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const eur0 = (n) => (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt = (n, d = 2) => (n ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: d });
const pct = (n, d = 1) => (n == null ? '–' : (n * 100).toLocaleString('fr-FR', { maximumFractionDigits: d }) + ' %');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const dateFr = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR') : '');
const addDays = (d, n) => new Date(new Date(d + 'T12:00:00').getTime() + n * 864e5).toISOString().slice(0, 10);
const ageDays = (d) => (d ? (Date.now() - new Date(d + 'T12:00:00').getTime()) / 864e5 : Infinity);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const BASES = {
  murs: { label: 'Murs', unite: 'm²' },
  plafond: { label: 'Plafond', unite: 'm²' },
  sol: { label: 'Sol', unite: 'm²' },
  perimetre: { label: 'Périmètre (plinthes, masquage)', unite: 'ml' },
  unite: { label: "À l'unité (porte, radiateur…)", unite: 'u' },
  forfait: { label: 'Forfait', unite: 'forfait' },
};
const CATEGORIES = ['Peinture', 'Sous-couche', 'Enduit', 'Revêtement', 'Protection', 'Adhésif / mastic', 'Outillage / consommable', 'Autre'];
const UNITES = ['L', 'kg', 'm²', 'ml', 'rouleau', 'pièce', 'lot'];
const STATUTS = {
  brouillon: 'Brouillon',
  envoye: 'Envoyé',
  accepte: 'Accepté',
  refuse: 'Refusé',
};
const PIECES_COURANTES = ['Salon', 'Séjour', 'Cuisine', 'Chambre', 'Chambre 2', 'Salle de bain', 'WC', 'Couloir', 'Entrée', 'Bureau', 'Cage d\'escalier', 'Buanderie'];

/* =========================================================================
   Stockage
   ========================================================================= */
const KEY = 'metre-devis.v1';
let storageOk = true;
let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { storageOk = false; }
  return seed();
}
function migrate(s) {
  const base = defaultSettings();
  s.settings = Object.assign({}, base, s.settings || {});
  s.settings.entreprise = Object.assign({}, base.entreprise, (s.settings && s.settings.entreprise) || {});
  s.produits = s.produits || [];
  s.ouvrages = s.ouvrages || [];
  s.devis = s.devis || [];
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
function toast(msg) {
  toastMsg = msg;
  listeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg = ''; listeners.forEach((l) => l()); }, 2800);
}

function defaultSettings() {
  return {
    entreprise: {
      nom: 'Etienne Peinture & Décoration', adresse: '', cp: '', ville: '', tel: '', email: '', siret: '',
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
  return r > 0 ? num(f.couches || 1) / r : 0;
}

function calcLigne(l, piece, pr) {
  const auto = surfaces(piece)[l.ouvrage.base] ?? 0;
  const qte = hasVal(l.qte) ? num(l.qte) : auto;
  const heures = qte * num(l.ouvrage.temps);
  const fourn = l.ouvrage.fournitures.map((f) => {
    const p = f.produit;
    const besoin = qte * consoOf(f, p) * (1 + num(pr.pertes));
    const prixUnit = num(p.contenance) > 0 ? num(p.prix) / num(p.contenance) : num(p.prix);
    return { produit: p, besoin, cout: besoin * prixUnit };
  });
  const coutFourn = sum(fourn, (f) => f.cout);
  const vente = heures * num(pr.tauxHoraire) + coutFourn * num(pr.coefFournitures);
  return { qte, auto, heures, fourn, coutFourn, vente, pu: qte ? vente / qte : 0, unite: BASES[l.ouvrage.base]?.unite || 'u' };
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
  const heures = sum(all, (x) => x.c.heures);
  const coutMO = heures * num(pr.coutHoraire);
  const diversVente = sum(d.divers, (x) => num(x.vente));
  const diversCout = sum(d.divers, (x) => num(x.cout));
  const sousTotal = sum(all, (x) => x.c.vente) + diversVente;
  const remise = sousTotal * num(d.remisePct) / 100;
  const totalHT = round2(sousTotal - remise);
  const coutTotal = coutFourn + coutMO + diversCout;
  const margeBrute = totalHT - coutFourn - diversCout; // ce qui reste pour payer le temps passé
  const marge = totalHT - coutTotal;
  const margePct = totalHT > 0 ? marge / totalHT : 0;
  const plancher = coutTotal / (1 - Math.min(0.9, num(pr.margeMini)));
  const tva = round2(totalHT * num(pr.tva) / 100);
  const res = {
    pieces, courses, coutFourn, heures, coutMO, diversVente, diversCout, sousTotal, remise, totalHT,
    coutTotal, margeBrute, marge, margePct, plancher, nego: totalHT - plancher, tva, ttc: totalHT + tva,
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
    res.negociation = totalHT > 0 ? 1 - signe / totalHT : 0;
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
function actualiserPrix(d) {
  for (const p of d.pieces) for (const l of p.lignes) {
    const o = ouvById(l.ouvrage.id);
    if (o) l.ouvrage = snapOuvrage(o, state.produits);
    else for (const f of l.ouvrage.fournitures) { const cur = prodById(f.produit.id); if (cur) f.produit = snapProduit(cur); }
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
  const n = s.settings.prochainNumero++;
  return `D${(date || today()).slice(0, 4)}-${String(n).padStart(3, '0')}`;
}
function nouvellePiece(nom) {
  return { id: uid(), nom: nom || '', L: null, l: null, H: 2.5, deduction: null, dedPerimetre: null, lignes: [] };
}
function nouveauDevis(s) {
  return {
    id: uid(), numero: numeroDevis(s), date: today(), statut: 'brouillon',
    client: { nom: '', adresse: '', tel: '', email: '' }, chantier: '', objet: 'Travaux de peinture',
    pieces: [nouvellePiece('Pièce 1')], divers: [], remisePct: 0,
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
  mk({ client: 'Mme Martin (exemple)', objet: 'Peinture salon et couloir', jours: 190, statut: 'accepte', signeCoef: 0.95, rexCoef: 1.12,
    pieces: [['Salon', 5.2, 4.1, 2.5, 5.4, std], ['Couloir', 6, 1.1, 2.5, 4.8, ['o1', 'o3', 'o6', 'o7', ['o8', 3]]]] });
  mk({ client: 'M. Durand (exemple)', objet: 'Rénovation chambre', jours: 150, statut: 'refuse', taux: 55,
    pieces: [['Chambre', 3.8, 3.2, 2.5, 3.4, ['o1', 'o2', 'o4', 'o5', 'o6', 'o7']]] });
  mk({ client: 'SCI Les Tilleuls (exemple)', objet: 'Remise en peinture T3 avant location', jours: 110, statut: 'accepte', signeCoef: 0.97, rexCoef: 1.05,
    divers: [{ designation: 'Évacuation des déchets', vente: 80, cout: 35 }],
    pieces: [['Séjour', 5.8, 4.2, 2.5, 6, std], ['Chambre', 3.5, 3.1, 2.5, 3.2, std], ['Chambre 2', 3.2, 3, 2.5, 3.2, std], ['Couloir', 4.5, 1.1, 2.5, 6.4, ['o1', 'o6', 'o7', ['o8', 4]]]] });
  mk({ client: 'M. Petit (exemple)', objet: 'Cuisine et entrée', jours: 75, statut: 'refuse', taux: 52, remisePct: 0,
    pieces: [['Cuisine', 3.6, 2.8, 2.5, 4.5, ['o1', 'o2', 'o4', 'o5', 'o6', 'o7']], ['Entrée', 2.2, 1.6, 2.5, 3.6, ['o1', 'o3', 'o6', 'o7']]] });
  mk({ client: 'Mme Leroy (exemple)', objet: 'Chambre enfant, toile de verre', jours: 40, statut: 'accepte', signeCoef: 0.92, rexCoef: 0.97,
    pieces: [['Chambre enfant', 3.4, 3, 2.5, 3.3, ['o1', 'o2', 'o3', 'o10', 'o6', 'o7', ['o8', 1]]]] });
  mk({ client: 'M. Bernard (exemple)', objet: 'Séjour double', jours: 6, statut: 'envoye',
    pieces: [['Séjour', 7.4, 4.6, 2.6, 8.2, [...std, 'o9', 'o11']]] });
  s.settings.prochainNumero = s.devis.length + 1;
  return s;
}

function effacerExemples() {
  update((s) => {
    s.devis = s.devis.filter((d) => !d.exemple);
    s.exemples = false;
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
function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file, 'utf-8'); });
}
const CSV_COLS = ['ref', 'nom', 'categorie', 'unite', 'contenance', 'prix_ht', 'rendement', 'fournisseur'];
function produitsCSV() {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const dec = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
  const rows = state.produits.map((p) => [p.ref, p.nom, p.categorie, p.unite, dec(p.contenance), dec(p.prix), dec(p.rendement), p.fournisseur].map(esc).join(';'));
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
  const iRef = idx('ref', 'reference', 'code'), iCat = idx('categorie', 'famille'), iUn = idx('unite'),
    iCont = idx('contenance', 'conditionnement', 'quantite'), iRend = idx('rendement'), iFour = idx('fournisseur');
  let maj = 0, ajout = 0;
  update((s) => {
    for (const r of rows.slice(1)) {
      const nom = (r[iNom] || '').trim();
      if (!nom) continue;
      const ref = iRef >= 0 ? (r[iRef] || '').trim() : '';
      let p = (ref && s.produits.find((x) => x.ref && norm(x.ref) === norm(ref))) || s.produits.find((x) => norm(x.nom) === norm(nom));
      const prix = num(r[iPrix]);
      if (!p) {
        p = { id: uid(), nom, ref, categorie: 'Autre', unite: 'pièce', contenance: 1, prix, rendement: null, fournisseur: '', maj: today(), historique: [] };
        s.produits.push(p); ajout++;
      } else {
        if (num(p.prix) !== prix) { p.historique = [...(p.historique || []), { date: p.maj, prix: p.prix }]; p.maj = today(); }
        else p.maj = today();
        p.exemple = false;
        maj++;
      }
      p.prix = prix;
      p.nom = nom;
      if (ref) p.ref = ref;
      if (iCat >= 0 && r[iCat]) p.categorie = r[iCat].trim();
      if (iUn >= 0 && r[iUn]) p.unite = r[iUn].trim();
      if (iCont >= 0 && r[iCont]) p.contenance = num(r[iCont]) || 1;
      if (iRend >= 0) p.rendement = hasVal((r[iRend] || '').trim()) ? num(r[iRend]) : p.rendement;
      if (iFour >= 0 && r[iFour]) p.fournisseur = r[iFour].trim();
    }
  });
  return { maj, ajout };
}
function exportSauvegarde() {
  update((s) => { s.settings.derniereSauvegarde = today(); });
  return JSON.stringify(state, null, 1);
}
function importSauvegarde(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.produits) || !Array.isArray(data.devis)) throw new Error("Ce fichier n'est pas une sauvegarde Métré & Devis.");
  state = migrate(data);
  save();
  listeners.forEach((l) => l());
}

/* =========================================================================
   Composants de base
   ========================================================================= */
const fmtIn = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
const parseIn = (t) => (String(t).trim() === '' ? null : num(t));

function NumIn({ value, onSet, onCommit, placeholder, id, cls, suffix }) {
  const [txt, setTxt] = useState(fmtIn(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current && parseIn(txt) !== (value ?? null)) setTxt(fmtIn(value)); }, [value]);
  const input = html`<input id=${id} class=${'num ' + (cls || '')} type="text" inputmode="decimal" autocomplete="off"
    value=${txt} placeholder=${placeholder}
    onFocus=${(e) => { focused.current = true; e.target.select(); }}
    onBlur=${() => { focused.current = false; }}
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
function App() {
  const s = useStore();
  const [tab, setTab] = useState('devis');
  const [devisId, setDevisId] = useState(null);
  const [doc, setDoc] = useState(null); // { id, kind: 'client' | 'courses' }

  useEffect(() => { window.scrollTo(0, 0); }, [tab, devisId, doc && doc.kind]);

  if (doc) {
    const d = s.devis.find((x) => x.id === doc.id);
    if (d) return html`<div class="shell">${doc.kind === 'courses'
      ? html`<${Courses} d=${d} onBack=${() => setDoc(null)} />`
      : html`<${DocClient} d=${d} onBack=${() => setDoc(null)} />`}</div><${Toast} />`;
  }

  const tabs = [['devis', 'Devis'], ['produits', 'Produits'], ['ouvrages', 'Ouvrages'], ['bilan', 'Bilan'], ['reglages', 'Réglages']];
  let view;
  if (tab === 'devis') {
    const d = devisId && s.devis.find((x) => x.id === devisId);
    view = d
      ? html`<${DevisEdit} d=${d} onBack=${() => setDevisId(null)} onDoc=${(kind) => setDoc({ id: d.id, kind })} onOpen=${setDevisId} />`
      : html`<${DevisList} onOpen=${setDevisId} />`;
  } else if (tab === 'produits') view = html`<${Produits} />`;
  else if (tab === 'ouvrages') view = html`<${Ouvrages} />`;
  else if (tab === 'bilan') view = html`<${Bilan} onOpen=${(id) => { setTab('devis'); setDevisId(id); }} />`;
  else view = html`<${Reglages} />`;

  return html`
    <div class="shell">
      <header class="topbar">
        <div class="brand"><${Logo} /><div><div class="brand-name">Métré & Devis</div><div class="brand-sub">${s.settings.entreprise.nom || 'Peinture & décoration'}</div></div></div>
        <nav class="tabs" aria-label="Sections">
          ${tabs.map(([k, l]) => html`<button type="button" class=${tab === k ? 'on' : ''} aria-current=${tab === k ? 'page' : null}
            onClick=${() => { setTab(k); if (k === 'devis') setDevisId(null); }}>${Icon[k]}<span>${l}</span></button>`)}
        </nav>
      </header>
      ${!storageOk ? html`<div class="banner warn">Ce navigateur ne peut pas enregistrer les données : elles seront perdues à la fermeture. Ouvrez l'appli dans un navigateur normal (pas en navigation privée).</div>` : null}
      ${view}
    </div>
    <${Toast} />`;
}
function Toast() { return toastMsg ? html`<div class="toast" role="status">${toastMsg}</div>` : null; }

/* ---------------------------------------------------------- Liste des devis */
function DevisList({ onOpen }) {
  const s = state;
  const [filtre, setFiltre] = useState('tous');
  const [q, setQ] = useState('');
  const list = s.devis
    .filter((d) => filtre === 'tous' || d.statut === filtre)
    .filter((d) => !q || norm(d.client.nom + ' ' + d.numero + ' ' + d.objet).includes(norm(q)))
    .slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.numero.localeCompare(a.numero));
  const counts = Object.fromEntries(Object.keys(STATUTS).map((k) => [k, s.devis.filter((d) => d.statut === k).length]));
  const nouveau = () => { let id; update((st) => { const d = nouveauDevis(st); st.devis.push(d); id = d.id; }); onOpen(id); };
  const backupOld = ageDays(s.settings.derniereSauvegarde) > 30 && s.devis.some((d) => !d.exemple);

  return html`<section class="section">
    <div class="section-head">
      <h1>Devis</h1>
      <button type="button" class="btn primary" onClick=${nouveau}>${Icon.plus} Nouveau devis</button>
    </div>
    ${s.devis.some((d) => d.exemple) ? html`<div class="banner info"><span>Les devis marqués « exemple » servent à découvrir l'appli et le bilan. Vous pourrez les effacer dans Réglages.</span></div>` : null}
    ${backupOld ? html`<div class="banner warn"><span>Pas de sauvegarde depuis plus d'un mois. Pensez à en faire une dans Réglages.</span></div>` : null}
    <div class="row">
      <div class="grow" style="flex-basis:220px"><input id="q-devis" type="text" placeholder="Rechercher un client, un n°…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="chips">
        <button type="button" class=${'chip' + (filtre === 'tous' ? ' on' : '')} onClick=${() => setFiltre('tous')}>Tous ${s.devis.length}</button>
        ${Object.entries(STATUTS).map(([k, l]) => html`<button type="button" class=${'chip' + (filtre === k ? ' on' : '')} onClick=${() => setFiltre(k)}>${l} ${counts[k]}</button>`)}
      </div>
    </div>
    ${list.length === 0
      ? html`<div class="card empty"><p>${s.devis.length ? 'Aucun devis ne correspond.' : 'Aucun devis pour le moment.'}</p><button type="button" class="btn primary" onClick=${nouveau}>Créer le premier devis</button></div>`
      : html`<div class="dlist">${list.map((d) => {
        const c = calcDevis(d);
        const p = d.statut === 'accepte' ? c.margeSigneePct : c.margePct;
        return html`<button type="button" class="ditem" key=${d.id} onClick=${() => onOpen(d.id)}>
          <div class="who">${d.client.nom || 'Client sans nom'}</div>
          <div class="amt">${eur0(d.statut === 'accepte' ? c.signe : c.totalHT)}</div>
          <div class="meta"><${Pill} statut=${d.statut} /><span>${d.numero}</span><span>${dateFr(d.date)}</span><span>${d.objet}</span></div>
          <div class="mg">marge <b class=${margeClass(p, num(d.params.margeMini))}>${pct(p, 0)}</b></div>
        </button>`;
      })}</div>`}
  </section>`;
}

/* ---------------------------------------------------------- Édition d'un devis */
function DevisEdit({ d, onBack, onDoc, onOpen }) {
  const s = state;
  const c = calcDevis(d);
  const [detail, setDetail] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const set = (fn) => update(() => fn(d));
  const nbModifs = d.statut === 'brouillon' || d.statut === 'envoye' ? produitsModifies(d) : 0;
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
    toast('Devis dupliqué');
    onOpen(id);
  };
  const prixCible = (v) => {
    if (v == null || c.sousTotal <= 0) return;
    set((d) => { d.remisePct = round2(Math.max(0, (1 - v / c.sousTotal) * 100)); });
  };

  return html`<section class="section">
    <div class="row between">
      <button type="button" class="btn ghost" onClick=${onBack}>${Icon.back} Tous les devis</button>
      <div class="row">
        <button type="button" class="btn" onClick=${() => onDoc('courses')}>Liste de courses</button>
        <button type="button" class="btn primary" onClick=${() => onDoc('client')}>Devis client</button>
      </div>
    </div>
    <div class="row between">
      <h1>${d.numero}</h1>
      ${d.exemple ? html`<span class="tag-ex">Exemple</span>` : null}
    </div>

    ${nbModifs ? html`<div class="banner warn"><span>Le prix de ${nbModifs} produit${nbModifs > 1 ? 's a' : ' a'} changé dans votre base depuis la création de ce devis.</span>
      <button type="button" class="btn sm" onClick=${() => { set(actualiserPrix); toast('Prix mis à jour'); }}>Mettre à jour les prix</button></div>` : null}

    <div class="card">
      <span class="tape">Client & chantier</span>
      <div class="fields">
        <${Field} label="Client"><${TextIn} id="cl-nom" value=${d.client.nom} placeholder="Nom du client" onSet=${(v) => set((d) => { d.client.nom = v; })} /><//>
        <${Field} label="Téléphone"><${TextIn} id="cl-tel" type="tel" value=${d.client.tel} onSet=${(v) => set((d) => { d.client.tel = v; })} /><//>
        <${Field} label="E-mail"><${TextIn} id="cl-mail" type="email" value=${d.client.email} onSet=${(v) => set((d) => { d.client.email = v; })} /><//>
        <${Field} label="Date du devis"><input id="cl-date" type="date" value=${d.date} onInput=${(e) => set((d) => { d.date = e.target.value; })} /><//>
        <${Field} label="Adresse du client" wide><${TextIn} id="cl-adr" value=${d.client.adresse} onSet=${(v) => set((d) => { d.client.adresse = v; })} /><//>
        <${Field} label="Adresse du chantier" hint="Si différente" wide><${TextIn} id="cl-ch" value=${d.chantier} onSet=${(v) => set((d) => { d.chantier = v; })} /><//>
        <${Field} label="Objet" wide><${TextIn} id="cl-obj" value=${d.objet} onSet=${(v) => set((d) => { d.objet = v; })} /><//>
      </div>
    </div>

    <datalist id="pieces-courantes">${PIECES_COURANTES.map((n) => html`<option value=${n}></option>`)}</datalist>
    <div class="section-head"><span class="tape">Métré par pièce</span><span class="muted small">Dimensions en mètres</span></div>
    ${d.pieces.map((p, i) => html`<${PieceCard} key=${p.id} d=${d} p=${p} i=${i} calc=${c.pieces[i]} />`)}
    <div class="row">
      <button type="button" class="btn" onClick=${() => set((d) => { d.pieces.push(nouvellePiece('Pièce ' + (d.pieces.length + 1))); })}>${Icon.plus} Ajouter une pièce</button>
    </div>

    <div class="card">
      <div class="row between"><span class="tape">Divers</span><span class="muted small">Déplacement, évacuation, location…</span></div>
      ${d.divers.length ? html`<div class="stack">${d.divers.map((x) => html`<div class="frow" key=${x.id}>
        <${Field} label="Désignation"><${TextIn} id=${'dv-n-' + x.id} value=${x.designation} onSet=${(v) => set(() => { x.designation = v; })} /><//>
        <${Field} label="Prix HT"><${NumIn} id=${'dv-v-' + x.id} value=${x.vente} onSet=${(v) => set(() => { x.vente = v; })} /><//>
        <${Field} label="Vous coûte"><${NumIn} id=${'dv-c-' + x.id} value=${x.cout} onSet=${(v) => set(() => { x.cout = v; })} /><//>
        <button type="button" class="x" aria-label="Supprimer" onClick=${() => set((d) => { d.divers = d.divers.filter((y) => y !== x); })}>×</button>
      </div>`)}</div>` : null}
      <div><button type="button" class="btn sm" onClick=${() => set((d) => { d.divers.push({ id: uid(), designation: '', vente: null, cout: null }); })}>${Icon.plus} Ligne divers</button></div>
    </div>

    <div class="card">
      <div class="row between"><span class="tape">Prix & remise</span>
        <button type="button" class="btn ghost sm" onClick=${() => setShowParams(!showParams)}>${showParams ? 'Masquer les tarifs' : 'Tarifs de ce devis'}</button></div>
      <div class="fields">
        <${Field} label="Remise %"><${NumIn} id="rm-pct" value=${d.remisePct} onSet=${(v) => set((d) => { d.remisePct = v ?? 0; })} /><//>
        <${Field} label="Ou prix cible HT" hint="Calcule la remise"><${NumIn} id="rm-cible" placeholder=${fmt(c.totalHT, 0)} onCommit=${prixCible} /><//>
      </div>
      ${showParams ? html`<div class="fields">
        <${Field} label="Taux horaire facturé"><${NumIn} id="pa-th" value=${d.params.tauxHoraire} suffix="€/h" onSet=${(v) => set((d) => { d.params.tauxHoraire = v; })} /><//>
        <${Field} label="Coût réel de l'heure"><${NumIn} id="pa-ch" value=${d.params.coutHoraire} suffix="€/h" onSet=${(v) => set((d) => { d.params.coutHoraire = v; })} /><//>
        <${Field} label="Coef. fournitures"><${NumIn} id="pa-cf" value=${d.params.coefFournitures} suffix="×" onSet=${(v) => set((d) => { d.params.coefFournitures = v; })} /><//>
        <${Field} label="Pertes"><${NumIn} id="pa-pe" value=${round2(num(d.params.pertes) * 100)} suffix="%" onSet=${(v) => set((d) => { d.params.pertes = num(v) / 100; })} /><//>
        <${Field} label="TVA"><${NumIn} id="pa-tva" value=${d.params.tva} suffix="%" onSet=${(v) => set((d) => { d.params.tva = v; })} /><//>
        <${Field} label="Marge mini"><${NumIn} id="pa-mm" value=${round2(num(d.params.margeMini) * 100)} suffix="%" onSet=${(v) => set((d) => { d.params.margeMini = num(v) / 100; })} /><//>
      </div><p class="hint">Ces tarifs sont propres à ce devis. Les valeurs par défaut se règlent dans Réglages.</p>` : null}
    </div>

    <div class="card">
      <span class="tape">Suivi</span>
      <div class="status-bar">${Object.entries(STATUTS).map(([k, l]) => html`<button type="button" class=${'st-' + k + (d.statut === k ? ' on' : '')} onClick=${() => setStatut(k)}>${l}</button>`)}</div>
      ${d.statut === 'accepte' ? html`
        <div class="fields">
          <${Field} label="Signé le"><input id="sg-date" type="date" value=${d.signe?.date || ''} onInput=${(e) => set((d) => { d.signe = { ...(d.signe || {}), date: e.target.value }; })} /><//>
          <${Field} label="Prix signé HT" hint=${c.negociation > 0.0005 ? 'Négocié de ' + pct(c.negociation) : 'Prix du devis'}><${NumIn} id="sg-prix" value=${d.signe?.prixHT} onSet=${(v) => set((d) => { d.signe = { ...(d.signe || {}), prixHT: v }; })} /><//>
        </div>
        <p class="lab">Retour de chantier (une fois terminé)</p>
        <div class="fields">
          <${Field} label="Heures réellement passées" hint=${'Prévu : ' + fmt(c.heures, 1) + ' h'}><${NumIn} id="rx-h" value=${d.rex?.heures} onSet=${(v) => set((d) => { d.rex = { ...(d.rex || {}), heures: v }; })} /><//>
          <${Field} label="Fournitures réellement achetées HT" hint=${'Prévu : ' + eur0(c.coutFourn)}><${NumIn} id="rx-f" value=${d.rex?.coutFournitures} onSet=${(v) => set((d) => { d.rex = { ...(d.rex || {}), coutFournitures: v }; })} /><//>
        </div>
        ${c.rexSaisi ? html`<p>Marge réelle : <b class=${margeClass(c.margeReellePct, mini)}>${eur0(c.margeReelle)} (${pct(c.margeReellePct)})</b> contre ${pct(c.margeSigneePct)} prévue.</p>` : null}
      ` : null}
      <${Field} label="Notes (internes, pas sur le devis)"><textarea id="dv-notes" value=${d.notes || ''} onInput=${(e) => set((d) => { d.notes = e.target.value; })}></textarea><//>
    </div>

    <div class="row">
      <button type="button" class="btn" onClick=${dupliquer}>Dupliquer ce devis</button>
      <${ConfirmBtn} label="Supprimer ce devis" confirm="Supprimer définitivement ?" onConfirm=${() => { onBack(); update((st) => { st.devis = st.devis.filter((x) => x.id !== d.id); }); toast('Devis supprimé'); }} />
    </div>

    <div class="summary" aria-live="polite">
      <div class="main">
        <div><div class="tot">${eur(c.totalHT)} <span class="small" style="font-weight:500">HT</span></div><div class="ttc">${eur(c.ttc)} TTC · ${fmt(c.heures, 1)} h de travail</div></div>
        <div class="mgbox"><div class="small" style="opacity:.75">marge nette</div><div class=${'mgv ' + margeClass(c.margePct, mini)}>${pct(c.margePct)}</div></div>
      </div>
      <button type="button" class="toggle" onClick=${() => setDetail(!detail)}>${detail ? 'Masquer le détail' : 'Voir coûts et marge de négociation'}</button>
      ${detail ? html`<dl>
        <dt>Sous-total avant remise</dt><dd>${eur(c.sousTotal)}</dd>
        ${c.remise ? html`<dt>Remise ${fmt(d.remisePct)} %</dt><dd>− ${eur(c.remise)}</dd>` : null}
        <div class="sep"></div>
        <dt>Fournitures (achat, pots entiers)</dt><dd>${eur(c.coutFourn)}</dd>
        <dt>Main d'œuvre au coût (${fmt(c.heures, 1)} h × ${eur(num(d.params.coutHoraire))})</dt><dd>${eur(c.coutMO)}</dd>
        ${c.diversCout ? html`<dt>Divers (coût)</dt><dd>${eur(c.diversCout)}</dd>` : null}
        <dt>Coût de revient total</dt><dd>${eur(c.coutTotal)}</dd>
        <div class="sep"></div>
        <dt>Marge nette</dt><dd>${eur(c.marge)}</dd>
        <dt>Gain de l'heure travaillée</dt><dd>${c.heures ? eur(c.margeBrute / c.heures) + '/h' : '–'}</dd>
        <dt>Prix plancher (marge mini ${pct(mini, 0)})</dt><dd>${eur(c.plancher)}</dd>
        <dt>Marge de négociation</dt><dd class=${c.nego < 0 ? 'mg-bad' : ''}>${c.nego >= 0 ? eur(c.nego) + ' (' + pct(c.totalHT ? c.nego / c.totalHT : 0, 0) + ')' : 'sous le plancher'}</dd>
        ${ref ? html`<div class="sep"></div><dt>Marge moyenne de vos devis signés</dt><dd>${pct(ref.moy)}</dd>
          <dt>Remise moyenne accordée</dt><dd>${pct(ref.nego)}</dd>` : null}
      </dl>` : null}
    </div>
  </section>`;
}

function refAcceptes(exceptId) {
  const acc = state.devis.filter((d) => d.statut === 'accepte' && d.id !== exceptId).map(calcDevis);
  if (!acc.length) return null;
  return { moy: avg(acc.map((c) => c.margeSigneePct)), nego: avg(acc.map((c) => c.negociation)), n: acc.length };
}

function PieceCard({ d, p, i, calc }) {
  const set = (fn) => update(() => fn(p));
  const sf = calc.surf;
  const ouvrages = state.ouvrages.slice().sort((a, b) => a.nom.localeCompare(b.nom));
  const prev = i > 0 ? d.pieces[i - 1] : null;
  const total = sum(calc.lignes, (x) => x.c.vente);
  const addOuv = (id) => { const o = ouvById(id); if (o) set((p) => { p.lignes.push(nouvelleLigne(o, state.produits)); }); };

  return html`<div class="card piece">
    <div class="piece-head">
      <div class="grow"><input id=${'pc-n-' + p.id} type="text" list="pieces-courantes" value=${p.nom} placeholder="Nom de la pièce" onInput=${(e) => set((p) => { p.nom = e.target.value; })} /></div>
      <span class="num" style="font-weight:700">${eur0(total)}</span>
    </div>
    <div class="fields tight">
      <${Field} label="Longueur"><${NumIn} id=${'pc-L-' + p.id} value=${p.L} placeholder="0" onSet=${(v) => set((p) => { p.L = v; })} /><//>
      <${Field} label="Largeur"><${NumIn} id=${'pc-l-' + p.id} value=${p.l} placeholder="0" onSet=${(v) => set((p) => { p.l = v; })} /><//>
      <${Field} label="Hauteur"><${NumIn} id=${'pc-H-' + p.id} value=${p.H} placeholder="2,5" onSet=${(v) => set((p) => { p.H = v; })} /><//>
      <${Field} label="Ouvertures m²" hint="À déduire des murs"><${NumIn} id=${'pc-d-' + p.id} value=${p.deduction} placeholder="0" onSet=${(v) => set((p) => { p.deduction = v; })} /><//>
    </div>
    <div class="chips">
      <button type="button" class="chip" onClick=${() => set((p) => { p.deduction = round2(num(p.deduction) + 1.6); p.dedPerimetre = round2(num(p.dedPerimetre) + 0.8); })}>+ Porte (1,6 m²)</button>
      <button type="button" class="chip" onClick=${() => set((p) => { p.deduction = round2(num(p.deduction) + 1.5); })}>+ Fenêtre (1,5 m²)</button>
      <button type="button" class="chip" onClick=${() => set((p) => { p.deduction = round2(num(p.deduction) + 2.6); p.dedPerimetre = round2(num(p.dedPerimetre) + 1.2); })}>+ Porte-fenêtre (2,6 m²)</button>
      ${num(p.deduction) ? html`<button type="button" class="chip" onClick=${() => set((p) => { p.deduction = null; p.dedPerimetre = null; })}>Remettre à 0</button>` : null}
    </div>
    <div class="surf">
      <span>Murs <b>${fmt(sf.murs, 1)} m²</b></span><span>Plafond <b>${fmt(sf.plafond, 1)} m²</b></span><span>Sol <b>${fmt(sf.sol, 1)} m²</b></span><span>Périmètre <b>${fmt(sf.perimetre, 1)} ml</b></span>
    </div>
    ${calc.lignes.length ? html`<div class="lignes">${calc.lignes.map(({ ligne: l, c }) => html`<div class="ligne" key=${l.id}>
      <div class="nm">${l.ouvrage.nom}<div class="sub">${fmt(c.heures, 1)} h · ${eur(c.pu)} / ${c.unite}${hasVal(l.qte) && l.ouvrage.base !== 'unite' && l.ouvrage.base !== 'forfait' ? ' · quantité saisie' : ''}</div></div>
      <${NumIn} id=${'lg-q-' + l.id} value=${l.qte} placeholder=${fmt(c.auto, 2)} onSet=${(v) => update(() => { l.qte = v; })} />
      <span class="u">${c.unite}</span>
      <span class="px">${eur(c.vente)}</span>
      <button type="button" class="x" aria-label=${'Retirer ' + l.ouvrage.nom} onClick=${() => set((p) => { p.lignes = p.lignes.filter((y) => y !== l); })}>×</button>
    </div>`)}</div>` : html`<p class="muted small">Ajoutez les travaux à faire dans cette pièce.</p>`}
    <div class="row">
      <div class="grow" style="flex-basis:220px">
        <select id=${'pc-add-' + p.id} aria-label="Ajouter un ouvrage" onChange=${(e) => { addOuv(e.target.value); e.target.value = ''; }}>
          <option value="">+ Ajouter un ouvrage…</option>
          ${ouvrages.map((o) => html`<option value=${o.id}>${o.nom}</option>`)}
        </select>
      </div>
      ${prev && prev.lignes.length && !p.lignes.length ? html`<button type="button" class="btn sm" onClick=${() => set((p) => { p.lignes = prev.lignes.map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: uid(), qte: l.ouvrage.base === 'unite' || l.ouvrage.base === 'forfait' ? l.qte : null })); })}>Mêmes travaux que « ${prev.nom} »</button>` : null}
    </div>
    <div class="row">
      <button type="button" class="btn ghost sm" onClick=${() => update(() => {
        const n = JSON.parse(JSON.stringify(p)); n.id = uid(); n.nom = p.nom + ' (copie)'; n.lignes.forEach((l) => { l.id = uid(); });
        d.pieces.splice(i + 1, 0, n);
      })}>Dupliquer la pièce</button>
      <${ConfirmBtn} cls="sm ghost" label="Supprimer la pièce" onConfirm=${() => update(() => { d.pieces = d.pieces.filter((x) => x !== p); })} />
    </div>
  </div>`;
}

/* ---------------------------------------------------------- Document client */
function DocClient({ d, onBack }) {
  const c = calcDevis(d);
  const e = state.settings.entreprise;
  const s = state.settings;
  return html`<div class="section">
    <div class="doc-bar no-print">
      <button type="button" class="btn ghost" onClick=${onBack}>${Icon.back} Retour au devis</button>
      <button type="button" class="btn primary" onClick=${() => { try { window.print(); } catch (err) {} }}>Imprimer / PDF</button>
    </div>
    <p class="hint no-print">Sur téléphone : « Imprimer » puis « Enregistrer en PDF » pour l'envoyer au client.</p>
    <article class="doc">
      <div class="dh">
        <div class="ent">
          <b>${e.nom}</b><br />
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
  const texte = `Courses – ${d.numero} ${d.client.nom}\n` + c.courses.map((e) => `- ${e.nb} × ${e.produit.nom} (${fmt(e.produit.contenance)} ${e.produit.unite})`).join('\n');
  const copier = () => {
    try { navigator.clipboard.writeText(texte).then(() => toast('Liste copiée'), () => toast('Copie impossible, sélectionnez le texte')); } catch (e) { toast('Copie impossible'); }
  };
  return html`<div class="section">
    <div class="doc-bar no-print">
      <button type="button" class="btn ghost" onClick=${onBack}>${Icon.back} Retour au devis</button>
      <div class="row"><button type="button" class="btn" onClick=${copier}>Copier la liste</button>
      <button type="button" class="btn primary" onClick=${() => { try { window.print(); } catch (err) {} }}>Imprimer</button></div>
    </div>
    <article class="doc">
      <div class="dh"><div><h1>Liste de courses</h1><div>${d.numero} · ${d.client.nom} · ${d.objet}</div></div>
        <div class="dref"><div>Pertes incluses : ${pct(num(d.params.pertes), 0)}</div><div>${fmt(c.heures, 1)} h de travail prévues</div></div></div>
      ${c.courses.length ? html`<div class="tbl-wrap"><table>
        <thead><tr><th>Produit</th><th class="n">Besoin</th><th class="n">Conditionnement</th><th class="n">À acheter</th><th class="n">Coût HT</th></tr></thead>
        <tbody>${c.courses.map((e) => html`<tr>
          <td>${e.produit.nom}</td><td class="n">${fmt(e.besoin, 1)} ${e.produit.unite}</td><td class="n">${fmt(e.produit.contenance)} ${e.produit.unite}</td>
          <td class="n"><b>${e.nb}</b></td><td class="n">${eur(e.cout)}</td></tr>`)}</tbody>
      </table></div>
      <div class="totals"><span class="big">Total fournitures HT</span><span class="n big">${eur(c.coutFourn)}</span></div>` : html`<p>Aucune fourniture : ajoutez des ouvrages au devis.</p>`}
    </article>
  </div>`;
}

/* ---------------------------------------------------------- Produits */
function setPrix(p, v) {
  if (v == null || num(v) === num(p.prix)) return;
  update(() => {
    p.historique = [...(p.historique || []), { date: p.maj, prix: p.prix }].slice(-20);
    p.prix = num(v); p.maj = today(); p.exemple = false;
  });
}
function Produits() {
  const s = state;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(null);
  const [outil, setOutil] = useState(false);
  const fileRef = useRef();
  const cats = [...new Set([...CATEGORIES.filter((c) => s.produits.some((p) => p.categorie === c)), ...s.produits.map((p) => p.categorie)])];
  const list = s.produits.filter((p) => (!cat || p.categorie === cat) && (!q || norm(p.nom + ' ' + (p.ref || '') + ' ' + (p.fournisseur || '')).includes(norm(q))));
  const groupes = cats.map((c) => [c, list.filter((p) => p.categorie === c)]).filter(([, l]) => l.length);
  const vieux = s.produits.filter((p) => ageDays(p.maj) > 180).length;
  const nouveau = () => {
    const p = { id: uid(), nom: 'Nouveau produit', categorie: cat || 'Peinture', unite: 'L', contenance: 1, prix: 0, rendement: null, fournisseur: '', ref: '', maj: today(), historique: [] };
    update((s) => { s.produits.unshift(p); });
    setQ(''); setOpen(p.id);
  };
  const onImport = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const r = importProduitsCSV(await readFile(f)); toast(`${r.maj} produit(s) mis à jour, ${r.ajout} ajouté(s)`); } catch (err) { toast(err.message); }
  };

  return html`<section class="section">
    <div class="section-head">
      <h1>Produits</h1>
      <div class="row">
        <button type="button" class="btn" onClick=${() => setOutil(!outil)}>Mettre à jour les prix</button>
        <button type="button" class="btn primary" onClick=${nouveau}>${Icon.plus} Produit</button>
      </div>
    </div>
    ${s.produits.some((p) => p.exemple) ? html`<div class="banner warn"><span>Les prix affichés sont des exemples. Remplacez-les par vos tarifs fournisseur (directement dans la liste ou par import de fichier).</span></div>` : null}
    ${vieux ? html`<div class="banner warn"><span>${vieux} prix n'ont pas été vérifiés depuis plus de 6 mois.</span></div>` : null}
    ${outil ? html`<${OutilPrix} onImport=${() => fileRef.current.click()} />` : null}
    <input ref=${fileRef} type="file" accept=".csv,text/csv" hidden onChange=${onImport} />
    <div class="row">
      <div class="grow" style="flex-basis:220px"><input id="q-prod" type="text" placeholder="Rechercher un produit, une réf, un fournisseur…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <select id="f-cat" style="width:auto" value=${cat} onChange=${(e) => setCat(e.target.value)}>
        <option value="">Toutes catégories</option>${cats.map((c) => html`<option value=${c}>${c}</option>`)}
      </select>
    </div>
    <div class="card">
      ${groupes.length === 0 ? html`<div class="empty">Aucun produit.</div>` : groupes.map(([c, l]) => html`
        <div class="cat-title">${c}</div>
        <div class="plist">${l.map((p) => open === p.id
          ? html`<${ProduitEdit} key=${p.id} p=${p} onClose=${() => setOpen(null)} />`
          : html`<div class="prow" key=${p.id}>
            <div class="grow">
              <button type="button" class="pn" onClick=${() => setOpen(p.id)}>${p.nom}</button>
              <div class="pm"><span>${fmt(p.contenance)} ${p.unite}</span>
                ${num(p.contenance) ? html`<span>${eur(num(p.prix) / num(p.contenance))}/${p.unite}</span>` : null}
                ${num(p.rendement) ? html`<span>1 ${p.unite} = ${fmt(p.rendement)} m²</span>` : null}
                ${p.fournisseur ? html`<span>${p.fournisseur}</span>` : null}
                <span class=${ageDays(p.maj) > 180 ? 'old' : ''}>prix du ${dateFr(p.maj)}</span></div>
            </div>
            <${NumIn} id=${'pp-' + p.id} value=${p.prix} suffix="€" onCommit=${(v) => { setPrix(p, v); toast('Prix enregistré'); }} />
          </div>`)}</div>`)}
    </div>
    <p class="hint">Touchez un prix pour le modifier : l'ancien prix est gardé dans l'historique. Les devis déjà envoyés gardent les prix du jour où ils ont été faits.</p>
  </section>`;
}

function OutilPrix({ onImport }) {
  const s = state;
  const [taux, setTaux] = useState(null);
  const [cat, setCat] = useState('');
  const [four, setFour] = useState('');
  const fours = [...new Set(s.produits.map((p) => p.fournisseur).filter(Boolean))];
  const cible = s.produits.filter((p) => (!cat || p.categorie === cat) && (!four || p.fournisseur === four));
  const appliquer = () => {
    if (!num(taux)) return;
    update(() => { for (const p of cible) { p.historique = [...(p.historique || []), { date: p.maj, prix: p.prix }].slice(-20); p.prix = round2(num(p.prix) * (1 + num(taux) / 100)); p.maj = today(); p.exemple = false; } });
    toast(`${cible.length} prix mis à jour`); setTaux(null);
  };
  return html`<div class="card">
    <span class="tape">Hausse ou baisse générale</span>
    <div class="fields">
      <${Field} label="Variation"><${NumIn} id="op-t" value=${taux} placeholder="ex. 4,5" suffix="%" onSet=${setTaux} /><//>
      <${Field} label="Fournisseur"><select id="op-f" value=${four} onChange=${(e) => setFour(e.target.value)}><option value="">Tous</option>${fours.map((f) => html`<option value=${f}>${f}</option>`)}</select><//>
      <${Field} label="Catégorie"><select id="op-c" value=${cat} onChange=${(e) => setCat(e.target.value)}><option value="">Toutes</option>${[...new Set(s.produits.map((p) => p.categorie))].map((c) => html`<option value=${c}>${c}</option>`)}</select><//>
    </div>
    <div class="row"><button type="button" class="btn primary" disabled=${!num(taux)} onClick=${appliquer}>Appliquer à ${cible.length} produit${cible.length > 1 ? 's' : ''}</button>
      <span class="hint">Mettez un chiffre négatif pour une baisse.</span></div>
    <span class="tape">Avec un tableur (Excel)</span>
    <p class="small">Exportez la liste, modifiez les prix dans Excel ou LibreOffice, puis importez le fichier : les produits sont reconnus par leur référence ou leur nom, et les nouveaux sont ajoutés.</p>
    <div class="row">
      <button type="button" class="btn" onClick=${() => { if (!download('produits-' + today() + '.csv', produitsCSV(), 'text/csv;charset=utf-8')) toast('Téléchargement impossible ici'); }}>Exporter la liste (.csv)</button>
      <button type="button" class="btn" onClick=${onImport}>Importer un fichier (.csv)</button>
    </div>
  </div>`;
}

function ProduitEdit({ p, onClose }) {
  const set = (fn) => update(() => { fn(p); p.exemple = false; });
  const used = state.ouvrages.filter((o) => o.fournitures.some((f) => f.produitId === p.id));
  return html`<div class="card" style="margin:8px 0;border-color:var(--accent)">
    <div class="fields">
      <${Field} label="Nom" wide><${TextIn} id=${'pe-n-' + p.id} value=${p.nom} onSet=${(v) => set((p) => { p.nom = v; })} /><//>
      <${Field} label="Catégorie"><input id=${'pe-c-' + p.id} type="text" list="cats" value=${p.categorie} onInput=${(e) => set((p) => { p.categorie = e.target.value; })} /><//>
      <${Field} label="Unité"><input id=${'pe-u-' + p.id} type="text" list="unites" value=${p.unite} onInput=${(e) => set((p) => { p.unite = e.target.value; })} /><//>
      <${Field} label="Contenance du conditionnement" hint=${'Ex. pot de 15 ' + p.unite}><${NumIn} id=${'pe-ct-' + p.id} value=${p.contenance} onSet=${(v) => set((p) => { p.contenance = v; })} /><//>
      <${Field} label="Prix d'achat HT du conditionnement"><${NumIn} id=${'pe-p-' + p.id} value=${p.prix} suffix="€" onCommit=${(v) => setPrix(p, v)} /><//>
      <${Field} label="Rendement" hint=${'m² (ou ml) couverts par 1 ' + p.unite + ', pour une couche'}><${NumIn} id=${'pe-r-' + p.id} value=${p.rendement} placeholder="ex. 10" onSet=${(v) => set((p) => { p.rendement = v; })} /><//>
      <${Field} label="Fournisseur"><${TextIn} id=${'pe-f-' + p.id} value=${p.fournisseur} onSet=${(v) => set((p) => { p.fournisseur = v; })} /><//>
      <${Field} label="Référence"><${TextIn} id=${'pe-ref-' + p.id} value=${p.ref} onSet=${(v) => set((p) => { p.ref = v; })} /><//>
    </div>
    ${p.historique && p.historique.length ? html`<div class="hist"><span class="lab">Historique des prix</span>
      ${[...p.historique].reverse().map((h) => html`<span>${dateFr(h.date)} : ${eur(num(h.prix))}</span>`)}<span>${dateFr(p.maj)} : <b>${eur(num(p.prix))}</b> (actuel)</span></div>` : null}
    ${used.length ? html`<p class="hint">Utilisé dans : ${used.map((o) => o.nom).join(', ')}</p>` : null}
    <div class="row between">
      <button type="button" class="btn primary" onClick=${onClose}>Fermer</button>
      <${ConfirmBtn} label="Supprimer" confirm=${used.length ? 'Supprimer (retiré des ouvrages) ?' : 'Supprimer ?'} onConfirm=${() => {
        update((s) => { s.produits = s.produits.filter((x) => x.id !== p.id); s.ouvrages.forEach((o) => { o.fournitures = o.fournitures.filter((f) => f.produitId !== p.id); }); });
        onClose();
      }} />
    </div>
    <datalist id="cats">${CATEGORIES.map((c) => html`<option value=${c}></option>`)}</datalist>
    <datalist id="unites">${UNITES.map((c) => html`<option value=${c}></option>`)}</datalist>
  </div>`;
}

/* ---------------------------------------------------------- Ouvrages */
function Ouvrages() {
  const s = state;
  const [open, setOpen] = useState(null);
  const o = open && s.ouvrages.find((x) => x.id === open);
  if (o) return html`<${OuvrageEdit} o=${o} onClose=${() => setOpen(null)} />`;
  const nouveau = () => {
    const n = { id: uid(), nom: 'Nouvel ouvrage', base: 'murs', temps: 0.1, fournitures: [] };
    update((s) => { s.ouvrages.push(n); });
    setOpen(n.id);
  };
  return html`<section class="section">
    <div class="section-head"><h1>Ouvrages</h1><button type="button" class="btn primary" onClick=${nouveau}>${Icon.plus} Ouvrage</button></div>
    <p class="muted">Un ouvrage, c'est un travail type (ex. « Peinture murs 2 couches ») : le temps qu'il vous faut par m² et les produits qu'il consomme. Le prix se calcule tout seul dans les devis.</p>
    <div class="olist">${s.ouvrages.map((o) => {
      const c = calcOuvrageIndicatif(o, s.settings);
      const u = BASES[o.base]?.unite;
      return html`<button type="button" class="card oitem" key=${o.id} onClick=${() => setOpen(o.id)}>
        <div style="font-weight:600">${o.nom}</div>
        <div class="op"><span class="muted small">${BASES[o.base]?.label.split(' (')[0]} · ${fmt(o.temps, 3)} h/${u}</span><span class="opv">${eur(c.vente)}<span class="small muted"> /${u}</span></span></div>
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
  return html`<section class="section">
    <div class="row between"><button type="button" class="btn ghost" onClick=${onClose}>${Icon.back} Tous les ouvrages</button></div>
    <div class="card">
      <div class="fields">
        <${Field} label="Nom (apparaît sur le devis)" wide><${TextIn} id="oe-n" value=${o.nom} onSet=${(v) => set((o) => { o.nom = v; })} /><//>
        <${Field} label="Se calcule sur"><select id="oe-b" value=${o.base} onChange=${(e) => set((o) => { o.base = e.target.value; })}>${Object.entries(BASES).map(([k, b]) => html`<option value=${k}>${b.label}</option>`)}</select><//>
        <${Field} label=${'Temps par ' + u} hint=${num(o.temps) ? 'soit ' + fmt(1 / num(o.temps), 1) + ' ' + u + ' à l\'heure' : ''}><${NumIn} id="oe-t" value=${o.temps} suffix="h" onSet=${(v) => set((o) => { o.temps = v; })} /><//>
      </div>
    </div>
    <div class="card">
      <span class="tape">Produits utilisés</span>
      ${o.fournitures.map((f, i) => {
        const p = prodById(f.produitId);
        const auto = p && num(p.rendement) ? num(f.couches || 1) / num(p.rendement) : null;
        return html`<div class="frow" key=${i}>
          <${Field} label="Produit"><select id=${'of-p-' + i} value=${f.produitId} onChange=${(e) => set(() => { f.produitId = e.target.value; })}>
            ${prods.map((x) => html`<option value=${x.id}>${x.nom}</option>`)}</select><//>
          <${Field} label="Couches"><${NumIn} id=${'of-c-' + i} value=${f.couches} onSet=${(v) => set(() => { f.couches = v; })} /><//>
          <${Field} label=${(p ? p.unite : '') + ' par ' + u}><${NumIn} id=${'of-q-' + i} value=${f.conso} placeholder=${auto != null ? fmt(auto, 3) : 'à saisir'} onSet=${(v) => set(() => { f.conso = v; })} /><//>
          <button type="button" class="x" aria-label="Retirer" onClick=${() => set((o) => { o.fournitures.splice(i, 1); })}>×</button>
        </div>`;
      })}
      <p class="hint">La consommation se calcule avec le rendement du produit et le nombre de couches. Remplissez « par ${u} » seulement pour forcer une autre valeur.</p>
      <div><button type="button" class="btn sm" disabled=${!prods.length} onClick=${() => set((o) => { o.fournitures.push({ produitId: prods[0].id, couches: 1, conso: null }); })}>${Icon.plus} Ajouter un produit</button></div>
    </div>
    <div class="card">
      <span class="tape">Prix indicatif</span>
      <div class="kpis">
        <div class="kpi"><span class="k">Prix de vente</span><span class="v">${eur(c.vente)}</span><span class="s">HT par ${u}</span></div>
        <div class="kpi"><span class="k">Fournitures</span><span class="v">${eur(c.coutFourn)}</span><span class="s">coût d'achat par ${u}</span></div>
        <div class="kpi"><span class="k">Marge nette</span><span class="v">${pct(c.vente ? c.marge / c.vente : 0)}</span><span class="s">${eur(c.marge)} par ${u}</span></div>
      </div>
      <p class="hint">Avec les tarifs par défaut : ${eur(s.settings.tauxHoraire)}/h facturé, fournitures × ${fmt(s.settings.coefFournitures)}, ${pct(s.settings.pertes, 0)} de pertes.</p>
    </div>
    <div class="row between">
      <div class="row">
        <button type="button" class="btn primary" onClick=${onClose}>Terminé</button>
        <button type="button" class="btn" onClick=${() => { update((s) => { s.ouvrages.push({ ...JSON.parse(JSON.stringify(o)), id: uid(), nom: o.nom + ' (copie)' }); }); toast('Ouvrage dupliqué'); }}>Dupliquer</button>
      </div>
      <${ConfirmBtn} label="Supprimer" onConfirm=${() => { update((s) => { s.ouvrages = s.ouvrages.filter((x) => x.id !== o.id); }); onClose(); }} />
    </div>
  </section>`;
}

/* ---------------------------------------------------------- Bilan / REX */
function Bilan({ onOpen }) {
  const s = state;
  const [periode, setPeriode] = useState('tout');
  const lim = periode === '12m' ? daysAgo(365) : periode === 'annee' ? new Date().getFullYear() + '-01-01' : '';
  const ds = s.devis.filter((d) => !lim || d.date >= lim).map((d) => ({ d, c: calcDevis(d) }));
  const acc = ds.filter((x) => x.d.statut === 'accepte');
  const ref = ds.filter((x) => x.d.statut === 'refuse');
  const env = ds.filter((x) => x.d.statut === 'envoye');
  const decides = acc.length + ref.length;
  const taux = decides ? acc.length / decides : null;
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

  // Prix au m² par ouvrage, signés vs refusés
  const parOuv = new Map();
  for (const { d, c } of [...acc, ...ref]) {
    const k = c.sousTotal > 0 ? (d.statut === 'accepte' ? c.signe : c.totalHT) / c.sousTotal : 1;
    for (const p of c.pieces) for (const { ligne: l, c: lc } of p.lignes) {
      if (!lc.qte || l.ouvrage.base === 'forfait') continue;
      const e = parOuv.get(l.ouvrage.nom) || { nom: l.ouvrage.nom, unite: lc.unite, acc: { q: 0, v: 0 }, ref: { q: 0, v: 0 } };
      const t = d.statut === 'accepte' ? e.acc : e.ref;
      t.q += lc.qte; t.v += lc.vente * k;
      parOuv.set(l.ouvrage.nom, e);
    }
  }
  const ouvRows = [...parOuv.values()].sort((a, b) => b.acc.v + b.ref.v - (a.acc.v + a.ref.v));

  const conseils = [];
  if (acc.length >= 2) conseils.push(html`Vos devis signés dégagent une marge nette de <b>${pct(minAcc, 0)}</b> à <b>${pct(maxAcc, 0)}</b> (moyenne ${pct(moyAcc, 0)}). Des clients ont déjà accepté ${pct(maxAcc, 0)} : vous pouvez partir de là, puis négocier sans descendre sous votre minimum de ${pct(mini, 0)} (le prix plancher est indiqué dans chaque devis).`);
  const sousMini = mAcc.filter((m) => m < mini).length;
  if (sousMini) conseils.push(html`<b>${sousMini} devis signé${sousMini > 1 ? 's sont' : ' est'}</b> sous votre marge minimum de ${pct(mini, 0)} : vous y avez travaillé presque sans bénéfice.`);
  if (nego != null && nego > 0.005) conseils.push(html`Vos clients obtiennent en moyenne <b>${pct(nego)}</b> de remise. Prévoyez cette marge dans le prix de départ pour ne pas la prendre sur votre bénéfice.`);
  if (moyRef != null && moyAcc != null && moyRef > moyAcc + 0.05) conseils.push(html`Les devis refusés avaient une marge plus haute (<b>${pct(moyRef, 0)}</b> contre ${pct(moyAcc, 0)}) : le prix a sans doute pesé dans le refus.`);
  if (moyRef != null && moyAcc != null && moyRef <= moyAcc + 0.05 && ref.length >= 2) conseils.push(html`Les devis refusés n'étaient pas plus chers en marge que les signés : le refus vient peut-être d'autre chose (délai, relance, présentation).`);
  if (ecartH != null && Math.abs(ecartH) > 0.04) conseils.push(html`Sur les chantiers terminés, vous passez en moyenne <b>${ecartH > 0 ? '+' : ''}${pct(ecartH, 0)}</b> de temps ${ecartH > 0 ? 'en plus' : 'en moins'} que prévu. ${ecartH > 0 ? 'Augmentez les temps de vos ouvrages pour ne pas travailler gratuitement.' : 'Vous avez de la marge sur vos temps.'}`);
  if (taux != null && decides >= 3 && taux > 0.8) conseils.push(html`Avec <b>${pct(taux, 0)}</b> de devis signés, vous pouvez sans doute monter un peu vos prix.`);
  if (taux != null && decides >= 3 && taux < 0.35) conseils.push(html`Seulement <b>${pct(taux, 0)}</b> de devis signés : comparez vos prix au m² ci-dessous avec ceux des devis acceptés.`);

  // Échelle des marges
  const all = [...mAcc, ...mRef];
  const hi = Math.max(0.5, Math.ceil((Math.max(0, ...all) + 0.05) * 10) / 10);
  const lo = Math.min(0, Math.floor(Math.min(0, ...all) * 10) / 10);
  const pos = (v) => ((v - lo) / (hi - lo)) * 100;
  const ticks = []; for (let t = lo; t <= hi + 1e-9; t += 0.1) ticks.push(round2(t));

  return html`<section class="section">
    <div class="section-head">
      <h1>Bilan</h1>
      <div class="chips">${[['tout', 'Tout'], ['12m', '12 derniers mois'], ['annee', 'Cette année']].map(([k, l]) => html`<button type="button" class=${'chip' + (periode === k ? ' on' : '')} onClick=${() => setPeriode(k)}>${l}</button>`)}</div>
    </div>
    ${s.devis.some((d) => d.exemple) ? html`<div class="banner info"><span>Ce bilan inclut les devis d'exemple.</span></div>` : null}
    <div class="kpis">
      <div class="kpi"><span class="k">Devis signés</span><span class="v">${pct(taux, 0)}</span><span class="s">${acc.length} signé(s) / ${decides} décidé(s)${env.length ? ' · ' + env.length + ' en attente' : ''}</span></div>
      <div class="kpi"><span class="k">Chiffre signé HT</span><span class="v">${eur0(ca)}</span><span class="s">${env.length ? eur0(sum(env, (x) => x.c.totalHT)) + ' en attente de réponse' : 'aucun devis en attente'}</span></div>
      <div class="kpi"><span class="k">Marge nette signée</span><span class=${'v ' + (moyAcc != null ? margeClass(moyAcc, mini) : '')}>${pct(moyAcc, 0)}</span><span class="s">${moyReelle != null ? 'réelle après chantier : ' + pct(moyReelle, 0) : 'moyenne des devis acceptés'}</span></div>
      <div class="kpi"><span class="k">Remise négociée</span><span class="v">${pct(nego)}</span><span class="s">en moyenne sur les devis signés</span></div>
    </div>

    ${all.length ? html`<div class="card">
      <span class="tape">Votre marge de négociation</span>
      <div class="scale" role="img" aria-label="Marge nette de chaque devis signé ou refusé">
        <div class="axis"></div>
        ${minAcc != null ? html`<div class="band" style=${`left:${pos(minAcc)}%;width:${Math.max(1, pos(maxAcc) - pos(minAcc))}%`}></div>` : null}
        ${ticks.map((t) => html`<span class="tick" style=${`left:${pos(t)}%`}>${Math.round(t * 100)}%</span>`)}
        ${ref.map((x) => html`<span class="dot ref" title=${x.d.client.nom + ' : ' + pct(x.c.margePct)} style=${`left:${pos(x.c.margePct)}%`}></span>`)}
        ${acc.map((x) => html`<span class="dot acc" title=${x.d.client.nom + ' : ' + pct(x.c.margeSigneePct)} style=${`left:${pos(x.c.margeSigneePct)}%`}></span>`)}
      </div>
      <div class="legend"><span><i style="background:var(--ok)"></i>Devis signé</span><span><i style="background:var(--bad)"></i>Devis refusé</span><span><i style="background:var(--ok-soft)"></i>Zone acceptée par vos clients</span></div>
      ${conseils.length ? html`<ul class="advice">${conseils.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="muted">Les conseils apparaissent quand vous avez au moins deux devis signés.</p>`}
    </div>` : html`<div class="card empty">Passez vos devis en « Accepté » ou « Refusé » pour voir votre bilan.</div>`}

    ${ouvRows.length ? html`<div class="card">
      <span class="tape">Prix pratiqués par ouvrage</span>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Ouvrage</th><th class="n">Signé</th><th class="n">Refusé</th><th class="n">Qté signée</th></tr></thead>
        <tbody>${ouvRows.map((r) => html`<tr>
          <td>${r.nom}</td>
          <td class="n">${r.acc.q ? eur(r.acc.v / r.acc.q) + '/' + r.unite : '–'}</td>
          <td class="n">${r.ref.q ? eur(r.ref.v / r.ref.q) + '/' + r.unite : '–'}</td>
          <td class="n">${r.acc.q ? fmt(r.acc.q, 0) + ' ' + r.unite : '–'}</td></tr>`)}</tbody>
      </table></div>
      <p class="hint">Prix moyen HT réellement facturé, remises et négociations comprises.</p>
    </div>` : null}

    ${acc.length ? html`<div class="card">
      <span class="tape">Chantiers signés : prévu et réel</span>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Client</th><th class="n">Signé HT</th><th class="n">Heures prévues / réelles</th><th class="n">Marge prévue</th><th class="n">Marge réelle</th></tr></thead>
        <tbody>${acc.sort((a, b) => b.d.date.localeCompare(a.d.date)).map(({ d, c }) => html`<tr style="cursor:pointer" onClick=${() => onOpen(d.id)}>
          <td>${d.client.nom}<div class="muted small">${d.numero} · ${dateFr(d.date)}</div></td>
          <td class="n">${eur0(c.signe)}</td>
          <td class="n">${fmt(c.heures, 0)} h / ${c.heuresReelles != null ? fmt(c.heuresReelles, 0) + ' h' : '–'}</td>
          <td class="n">${pct(c.margeSigneePct, 0)}</td>
          <td class="n">${c.rexSaisi ? html`<b class=${margeClass(c.margeReellePct, mini)}>${pct(c.margeReellePct, 0)}</b>` : html`<span class="muted">à saisir</span>`}</td></tr>`)}</tbody>
      </table></div>
      <p class="hint">Saisissez les heures et fournitures réelles dans chaque devis signé (rubrique Suivi) une fois le chantier fini.</p>
    </div>` : null}
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
  const sauver = () => {
    const txt = exportSauvegarde();
    if (!download('metre-devis-sauvegarde-' + today() + '.json', txt, 'application/json')) toast('Téléchargement impossible ici');
    else toast('Sauvegarde téléchargée');
  };
  const copier = () => {
    const txt = exportSauvegarde();
    try { navigator.clipboard.writeText(txt).then(() => toast('Données copiées'), () => setCopie(true)); } catch (err) { setCopie(true); }
  };

  return html`<section class="section">
    <h1>Réglages</h1>
    <div class="card">
      <span class="tape">Entreprise (en-tête du devis)</span>
      <div class="fields">
        <${Field} label="Nom de l'entreprise" wide><${TextIn} id="e-nom" value=${e.nom} onSet=${(v) => set((st) => { st.entreprise.nom = v; })} /><//>
        <${Field} label="Adresse" wide><${TextIn} id="e-adr" value=${e.adresse} onSet=${(v) => set((st) => { st.entreprise.adresse = v; })} /><//>
        <${Field} label="Code postal"><${TextIn} id="e-cp" value=${e.cp} onSet=${(v) => set((st) => { st.entreprise.cp = v; })} /><//>
        <${Field} label="Ville"><${TextIn} id="e-ville" value=${e.ville} onSet=${(v) => set((st) => { st.entreprise.ville = v; })} /><//>
        <${Field} label="Téléphone"><${TextIn} id="e-tel" type="tel" value=${e.tel} onSet=${(v) => set((st) => { st.entreprise.tel = v; })} /><//>
        <${Field} label="E-mail"><${TextIn} id="e-mail" type="email" value=${e.email} onSet=${(v) => set((st) => { st.entreprise.email = v; })} /><//>
        <${Field} label="SIRET"><${TextIn} id="e-siret" value=${e.siret} onSet=${(v) => set((st) => { st.entreprise.siret = v; })} /><//>
        <${Field} label="Assurance décennale" hint="Assureur, n° de contrat, zone couverte (obligatoire sur le devis)" wide><${TextIn} id="e-ass" value=${e.assurance} onSet=${(v) => set((st) => { st.entreprise.assurance = v; })} /><//>
        <${Field} label="Mentions en bas de devis" wide><textarea id="e-ment" value=${e.mentions} onInput=${(ev) => set((st) => { st.entreprise.mentions = ev.target.value; })}></textarea><//>
      </div>
    </div>
    <div class="card">
      <span class="tape">Tarifs par défaut des nouveaux devis</span>
      <div class="fields">
        <${Field} label="Taux horaire facturé" hint="Prix de l'heure pour le client"><${NumIn} id="s-th" value=${st.tauxHoraire} suffix="€/h" onSet=${(v) => set((st) => { st.tauxHoraire = v; })} /><//>
        <${Field} label="Coût réel de l'heure" hint="Charges, véhicule, assurance, votre salaire…"><${NumIn} id="s-ch" value=${st.coutHoraire} suffix="€/h" onSet=${(v) => set((st) => { st.coutHoraire = v; })} /><//>
        <${Field} label="Coefficient fournitures" hint="1,25 = prix d'achat + 25 %"><${NumIn} id="s-cf" value=${st.coefFournitures} suffix="×" onSet=${(v) => set((st) => { st.coefFournitures = v; })} /><//>
        <${Field} label="Pertes / surconsommation"><${NumIn} id="s-pe" value=${round2(num(st.pertes) * 100)} suffix="%" onSet=${(v) => set((st) => { st.pertes = num(v) / 100; })} /><//>
        <${Field} label="TVA" hint="10 % en rénovation de logement"><${NumIn} id="s-tva" value=${st.tva} suffix="%" onSet=${(v) => set((st) => { st.tva = v; })} /><//>
        <${Field} label="Marge nette minimum" hint="Sert à calculer le prix plancher"><${NumIn} id="s-mm" value=${round2(num(st.margeMini) * 100)} suffix="%" onSet=${(v) => set((st) => { st.margeMini = num(v) / 100; })} /><//>
        <${Field} label="Validité du devis"><${NumIn} id="s-val" value=${st.validite} suffix="jours" onSet=${(v) => set((st) => { st.validite = v; })} /><//>
        <${Field} label="Acompte à la signature"><${NumIn} id="s-ac" value=${st.acompte} suffix="%" onSet=${(v) => set((st) => { st.acompte = v; })} /><//>
        <${Field} label="Prochain n° de devis"><${NumIn} id="s-num" value=${st.prochainNumero} onSet=${(v) => set((st) => { st.prochainNumero = Math.max(1, Math.round(num(v))); })} /><//>
      </div>
    </div>
    <div class="card">
      <span class="tape">Sauvegarde</span>
      <p>Les données sont enregistrées sur cet appareil uniquement. Faites une sauvegarde régulièrement (ex. une fois par mois) et gardez le fichier sur votre ordinateur ou dans vos e-mails.</p>
      <p class="muted small">Dernière sauvegarde : ${st.derniereSauvegarde ? dateFr(st.derniereSauvegarde) : 'jamais'}</p>
      <div class="row">
        <button type="button" class="btn primary" onClick=${sauver}>Télécharger une sauvegarde</button>
        <button type="button" class="btn" onClick=${() => fileRef.current.click()}>Restaurer une sauvegarde</button>
        <button type="button" class="btn ghost" onClick=${copier}>Copier les données</button>
      </div>
      <input ref=${fileRef} type="file" accept=".json,application/json" hidden onChange=${onRestore} />
      ${copie ? html`<textarea id="copie" readonly style="min-height:120px" onFocus=${(ev) => ev.target.select()} value=${JSON.stringify(state)}></textarea>` : null}
      <p class="hint">Restaurer remplace toutes les données actuelles par celles du fichier.</p>
    </div>
    <div class="card">
      <span class="tape">Nettoyage</span>
      <div class="row">
        ${s.devis.some((d) => d.exemple) ? html`<${ConfirmBtn} label="Effacer les devis d'exemple" onConfirm=${() => { effacerExemples(); toast('Exemples effacés'); }} />` : html`<span class="muted small">Aucun devis d'exemple.</span>`}
        <${ConfirmBtn} label="Tout effacer et repartir des exemples" confirm="Vraiment tout effacer ?" onConfirm=${() => { state = seed(); save(); listeners.forEach((l) => l()); toast('Données réinitialisées'); }} />
      </div>
    </div>
  </section>`;
}

render(html`<${App} />`, document.getElementById('app'));
