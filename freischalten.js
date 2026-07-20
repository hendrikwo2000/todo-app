"use strict";

/* ====================================================================
   Landeseite fuer den Freischalt-Link aus der Benachrichtigungsmail.

   Das blosse Oeffnen tut nichts - erst der Klick auf den Knopf schickt
   das POST. Grund: Mailprogramme und Sicherheitsscanner oeffnen Links in
   Mails teilweise von sich aus. Wuerde schon das Oeffnen freischalten,
   koennte ein Scanner das ungefragt tun.
   ==================================================================== */

const API = "/api/admin/genehmigen";
const token = new URLSearchParams(location.search).get("t") || "";

const an = (id, sichtbar) => { document.getElementById(id).hidden = !sichtbar; };
const text = (id, wert) => { document.getElementById(id).textContent = wert; };

function zeigeFehler(nachricht) {
  an("ladeAnzeige", false);
  an("frage", false);
  an("fertig", false);
  text("fehlerText", nachricht);
  an("fehler", true);
}

async function laden() {
  if (!token) return zeigeFehler("In diesem Link fehlt die Kennung.");
  let res, daten;
  try {
    res = await fetch(`${API}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
    daten = await res.json();
  } catch (e) {
    return zeigeFehler("Server nicht erreichbar.");
  }
  if (!res.ok) return zeigeFehler(daten.error || "Dieser Link funktioniert nicht mehr.");

  if (daten.erledigt) {
    an("ladeAnzeige", false);
    text("fertigTitel", "Schon erledigt");
    text("fertigText", daten.status === "freigeschaltet"
      ? `${daten.name} ist bereits freigeschaltet.`
      : `Diese Anfrage wurde bereits bearbeitet (${daten.status}).`);
    return an("fertig", true);
  }

  an("ladeAnzeige", false);
  text("wer", `${daten.name} · ${daten.email}`);
  an("frage", true);
}

document.getElementById("jaKnopf").addEventListener("click", async e => {
  e.target.disabled = true;
  let res, daten;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token }),
    });
    daten = await res.json();
  } catch (err) {
    e.target.disabled = false;
    return zeigeFehler("Server nicht erreichbar.");
  }
  if (!res.ok) return zeigeFehler(daten.error || "Freischalten hat nicht geklappt.");

  an("frage", false);
  text("fertigTitel", "Freigeschaltet");
  text("fertigText", daten.mailVerschickt === false
    ? `${daten.name} hat jetzt Zugang — die Willkommensmail ging allerdings nicht raus.`
    : `${daten.name} hat jetzt Zugang und eine Willkommensmail bekommen.`);
  an("fertig", true);
});

// Design-Einstellung von der Hauptseite uebernehmen.
const gespeichert = localStorage.getItem("theme");
if (gespeichert) document.documentElement.dataset.theme = gespeichert;

laden();
