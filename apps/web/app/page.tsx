"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import Link from "next/link";
import "./landing.css";

const destinations = [
  { name: "Setbacks", region: "PLOT & ROAD WIDTH", line: "Know the gaps your building needs.", detail: "For a setback question, include the plot area, road width, and proposed building use. The applicable rule and table provide the basis for reviewing the required gaps.", stops: ["State your plot area and road width", "Describe the proposed building use", "Check the cited rule, table, and source date"] },
  { name: "Fees", region: "BUILDING PERMISSION", line: "Find the basis for permission fees.", detail: "For a fee question, describe the proposed construction and its use. Check the applicable fee table and calculation inputs against the source document before using a figure.", stops: ["Describe the construction and its use", "Provide the relevant area measurements", "Review the fee table and calculation basis"] },
  { name: "Floor Area", region: "DEVELOPMENT LIMITS", line: "Understand the limits for your plot.", detail: "For a floor-area or floor-count question, include the plot area, road width, building use, and proposed height. Review the applicable limits together rather than inferring a floor count from one number.", stops: ["State the plot area and road width", "Describe the use and proposed height", "Review the applicable limits and source text"] },
];

type Panel = "menu" | "yatra" | "places" | "stories" | "about" | "start";
const navigation: { label: string; panel: Panel }[] = [
  { label: "Guide", panel: "yatra" }, { label: "Rules", panel: "places" },
  { label: "Sources", panel: "stories" }, { label: "About", panel: "about" },
];

function Arrow() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Emblem() {
  return <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M32 3 27 34l5 25 5-25L32 3Z" /><path d="M23 19C14 17 8 19 3 22c6 2 12 3 20 2v-5Zm0 11C14 28 8 30 3 33c6 2 12 3 20 2v-5Zm0 11C14 39 8 41 3 44c6 2 12 3 20 2v-5Zm18-22c9-2 15 0 20 3-6 2-12 3-20 2v-5Zm0 11c9-2 15 0 20 3-6 2-12 3-20 2v-5Zm0 11c9-2 15 0 20 3-6 2-12 3-20 2v-5Z" /></svg>;
}

function Finial() {
  return <svg className="title-finial" viewBox="0 0 44 110" fill="currentColor" aria-hidden="true"><path d="M22 0c-1 17-5 22-7 26h14c-2-4-6-9-7-26Z" /><ellipse cx="22" cy="32" rx="9" ry="5" /><ellipse cx="22" cy="44" rx="12" ry="6" /><ellipse cx="22" cy="59" rx="15" ry="7" /><ellipse cx="22" cy="76" rx="18" ry="8" /><ellipse cx="22" cy="96" rx="22" ry="9" /><path d="M4 106h36v4H4z" /></svg>;
}

export default function Home() {
  const root = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [destination, setDestination] = useState("Setbacks");
  const [journeyReady, setJourneyReady] = useState(false);
  const isPanelOpen = panel !== null;
  const place = destinations.find((item) => item.name === destination)!;

  useLayoutEffect(() => {
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      // Reveal complete groups once, with restrained movement and no looping.
      const intro = gsap.timeline({ defaults: { ease: "sine.out" } });
      intro.from(".site-header", { opacity: 0, duration: 0.65 }, 0)
        .from(".hero-title", { y: 8, opacity: 0, duration: 0.95 }, 0.08)
        .from(".hero-details", { y: 5, opacity: 0, duration: 0.75 }, 0.25)
        .from(".menu-dock", { opacity: 0, duration: 0.65 }, 0.4);
    }, root);
    return () => motion.revert();
  }, []);

  useEffect(() => {
    if (!isPanelOpen || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, [isPanelOpen]);

  useEffect(() => {
    if (!panel || !dialog.current) return;
    const element = dialog.current;
    const context = gsap.context(() => {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.fromTo(element, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: "sine.out" });
      }
    }, element);
    return () => context.revert();
  }, [panel]);

  function openPanel(next: Panel) {
    setJourneyReady(false);
    setPanel(next);
  }

  return (
    <main ref={root} className="landing">
      <div className="landscape" role="img" aria-label="An indigo and cream illustration of an Indian temple city beside the water" />
      <div className="landscape-shade" aria-hidden="true" />
      <a className="skip-link" href="#main-content">Skip to content</a>

      <header className="site-header">
        <Link href="/" className="brand header-reveal" aria-label="Sarthi home"><Emblem /></Link>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item.panel} className="nav-link header-reveal" onClick={() => openPanel(item.panel)}>{item.label}</button>)}
        </nav>
        <button className="get-started header-reveal" onClick={() => openPanel("start")}><span>Login</span><Arrow /></button>
      </header>

      <section className="hero-copy" id="main-content" aria-labelledby="hero-title">
        <h1 className="hero-title" id="hero-title" aria-label="Sarthi">
          <span className="title-letters" aria-hidden="true">{"Sarth".split("").map((letter, index) => <span className="title-letter" key={index}>{letter}</span>)}<span className="title-letter final-letter">ı<Finial /></span></span>
        </h1>
        <div className="hero-details">
          <p className="hero-tagline copy-reveal">Building Rules.<br />Clear Answers.</p>
          <span className="hero-rule copy-reveal" aria-hidden="true" />
          <p className="hero-caption copy-reveal"><span>Bhopal</span><i>/</i><span>Rules</span><i>/</i><span>Sources</span><i>/</i><span>English & Hindi</span></p>
        </div>
      </section>

      <button className="menu-dock" onClick={() => openPanel("menu")} aria-haspopup="dialog" aria-label="Open menu"><span>Menu</span><span className="menu-icon" aria-hidden="true"><i /><i /><i /><i /></span></button>

      <dialog ref={dialog} className={`explore-panel ${panel === "menu" ? "navigation-panel" : ""}`} aria-labelledby="panel-title" onCancel={() => setPanel(null)} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setPanel(null); } }}>
        <button className="panel-close" aria-label="Close panel" onClick={() => setPanel(null)} autoFocus><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.4" /></svg></button>
        <p className="eyebrow panel-reveal">SARTHI · BHUMI VIKAS SAHAYAK</p>
        {panel === "menu" ? <>
          <h2 id="panel-title" className="panel-reveal">Know the rulebook.</h2>
          <div className="menu-links">{navigation.map((item, index) => <button className="panel-reveal" key={item.panel} onClick={() => openPanel(item.panel)}><span className="menu-number">0{index + 1}</span><span>{item.label}</span><Arrow /></button>)}</div>
          <button className="panel-cta panel-reveal" onClick={() => openPanel("start")}>Explore a rule topic <Arrow /></button>
        </> : panel === "start" || panel === "yatra" ? <>
          <h2 id="panel-title" className="panel-reveal">{journeyReady ? `About ${place.name}.` : "Start with your question."}</h2>
          <p className="panel-description panel-reveal">{journeyReady ? place.detail : "Choose a building-rule topic to see what details your question needs. This guide helps you prepare a question in English or Hindi."}</p>
          {journeyReady ? <div className="journey-stops">{place.stops.map((stop, index) => <div key={stop}><span>0{index + 1}</span><p>{stop}</p></div>)}<p className="journey-note">Topic guidance, not a rule determination. The supplied rulebook is consolidated to 6 March 2025. The clerk reviews the rule and decides.</p><button className="text-button" onClick={() => setJourneyReady(false)}>← Explore another topic</button></div> : <form className="journey-form panel-reveal" onSubmit={(event) => { event.preventDefault(); setJourneyReady(true); }}><label htmlFor="destination">YOUR RULE TOPIC</label><select id="destination" value={destination} onChange={(event) => setDestination(event.target.value)}>{destinations.map((item) => <option key={item.name}>{item.name}</option>)}</select><button className="panel-cta" type="submit">View topic guide <Arrow /></button></form>}
        </> : panel === "places" ? <>
          <h2 id="panel-title" className="panel-reveal">Rules for your next plan.</h2>
          <p className="panel-description panel-reveal">Setbacks, permission fees, and floor-area limits under the MP Bhumi Vikas Rules, 2012.</p>
          <div className="destination-list">{destinations.map((item, index) => <button className="destination-card panel-reveal" key={item.name} onClick={() => { setDestination(item.name); openPanel("start"); }}><span className="destination-index">0{index + 1}</span><div><span className="eyebrow">{item.region}</span><h3>{item.name}</h3><p>{item.line}</p></div><Arrow /></button>)}</div>
        </> : panel === "stories" ? <>
          <h2 id="panel-title" className="panel-reveal">Know the source.</h2>
          <p className="panel-description panel-reveal">A rule number, its exact text, and the source version make an answer reviewable.</p>
          <article className="story panel-reveal"><span className="eyebrow">01 / THE RULEBOOK</span><h3>MP Bhumi Vikas Rules, 2012.</h3><p>The participant pack contains the official English and Hindi rulebooks, consolidated to 6 March 2025. The English PDF is the source of truth for the supplied data. Table values should be checked against the original PDF.</p></article>
          <article className="story panel-reveal"><span className="eyebrow">02 / VERSION MATTERS</span><h3>Make the limits clear.</h3><p>The supplied data excludes changes after 6 March 2025, including the 28 August 2026 amendment to Rule 2(5)(c). When the source does not answer a question, say so clearly. Rule references support the clerk&apos;s decision; they are not legal advice.</p></article>
        </> : <>
          <h2 id="panel-title" className="panel-reveal">A companion to clarity.</h2>
          <p className="panel-description panel-reveal">Sarthi brings the Bhumi Vikas Sahayak problem into focus: helping a Bhopal Municipal Corporation building-permission clerk find the rule behind a citizen&apos;s question.</p>
          <p className="about-copy panel-reveal">The goal is a short answer in the question&apos;s language, English or Hindi, with the rule number and exact supporting text. Clear source dates and honest gaps help the clerk review the answer and decide.</p>
          <button className="panel-cta panel-reveal" onClick={() => openPanel("start")}>Explore rule topics <Arrow /></button>
        </>}
      </dialog>
    </main>
  );
}
