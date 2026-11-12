"use client";
export default function FinanceError({reset}:{reset:()=>void}){return <section role="alert"><h1>Unable to load finance records</h1><p>Retry to check your current access and reload the record.</p><button type="button" onClick={reset}>Retry finance view</button></section>;}
