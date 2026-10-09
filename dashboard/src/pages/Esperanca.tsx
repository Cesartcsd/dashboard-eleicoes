import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { CandidatePicker, ErrorBox, Loading, MunicipioSelect, Segmented, nomeCand } from "../components/ui";
import { cssRgb, prefersDark, type RGB } from "../lib/colors";
import { useBase, useTotais, useVotos, type Base, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L } from "../lib/i18n";
import { CARGOS, type Candidatura, type TotaisCols, type VotosCols } from "../lib/types";
import { MOBILIZACAO, NOME_FAIXA, agrega, linha, useBaseCandidatura, useCandidaturasAcompanhadas, type Faixa, type Linha, type LinhaNossa, type Terr } from "../lib/atuacao";
import { useUf } from "../lib/uf";
import { isDev, source } from "../lib/source";
import { useSouAdmin } from "../lib/acessos";
import type { AnaliseTerritorial } from "../lib/types";
import { supabase } from "../lib/supabase";

/*
 * Mapa de Mobilização: compara duas candidaturas por cidade e bairro e simula o saldo líquido produzido pela
 * mobilização de uma parcela dos abstencionistas, mantendo o padrão de voto observado no território.
 */

// divergente laranja ↔ roxo (mesma paleta validada do Apocalipse): saldo negativo, nulo, positivo
const RAMPA = () => (prefersDark()
  ? ["#c47c22", "#7a5a3a", "#3a343f", "#7a4f9a", "#b37ad9"]
  : ["#c86a00", "#eab27a", "#e6e2e8", "#b98ad6", "#6a2399"]).map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as RGB);

export function Esperanca() {
  const base = useBase();
  const { uf } = useUf();
  const [modo, setModo] = useState<"predefinida" | "personalizada" | "salvas">("predefinida");
  const lula = base.data?.candidaturas.find((c) => c.cargo === 1 && c.numero === 13);
  const adv = base.data?.candidaturas.filter((c) => c.cargo === 1 && c.tipo === "nominal" && c.numero !== 13)
    .sort((a, b) => (Number(b.situacao === "2º turno") - Number(a.situacao === "2º turno")) || b.votos - a.votos)[0];
  if (base.error) return <ErrorBox error={base.error} />;
  if (!base.data) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <Segmented label={L("Modo da análise", "Analysis mode")} value={modo} onChange={(v) => setModo(v as typeof modo)} options={[
        { id: "predefinida", label: L("Predefinida", "Preset") },
        { id: "personalizada", label: L("Personalizada", "Custom") },
        { id: "salvas", label: L("Salvas", "Saved") },
      ]} />
      {modo === "predefinida" && (lula && adv
        ? <Analise base={base.data} principal={lula} adversaria={adv} mobilizacao={MOBILIZACAO} municipio={null} predefinida />
        : <p className="text-muted">{L("Duelo presidencial não disponível nesta UF.", "Presidential match-up unavailable in this state.")}</p>)}
      {modo === "personalizada" && <EditorAnalise base={base.data} uf={uf} />}
      {modo === "salvas" && <AnalisesSalvas base={base.data} uf={uf} />}
      <GerenciarAcompanhadas base={base.data} />
    </div>
  );
}

function Analise({ base, principal, adversaria, mobilizacao, municipio, predefinida = false }: {
  base: Base; principal: Candidatura; adversaria: Candidatura; mobilizacao: number; municipio: string | null; predefinida?: boolean;
}) {
  const votos = useVotos([principal.id, adversaria.id], municipio);
  const totais = useTotais(principal.cargo, municipio);
  if (votos.error) return <ErrorBox error={votos.error} />;
  if (totais.error) return <ErrorBox error={totais.error} />;
  if (!votos.data || !totais.data) return <Loading />;
  return <Painel base={base} lula={principal} adv={adversaria} votos={votos.data} totais={totais.data}
    mobilizacao={mobilizacao} municipio={municipio} predefinida={predefinida} />;
}

function EditorAnalise({ base, uf, inicial }: { base: Base; uf: string; inicial?: AnaliseTerritorial }) {
  const qc = useQueryClient();
  const [titulo_, setTitulo] = useState(inicial?.titulo ?? "");
  const [cargo, setCargo] = useState(inicial?.cd_cargo ?? 1);
  const [principal, setPrincipal] = useState<Candidatura | null>(inicial ? base.candById.get(inicial.candidatura_principal_id) ?? null : null);
  const [adversaria, setAdversaria] = useState<Candidatura | null>(inicial ? base.candById.get(inicial.candidatura_adversaria_id) ?? null : null);
  const [municipio, setMunicipio] = useState<string | null>(inicial?.cd_municipio ?? null);
  const [mobilizacao, setMobilizacao] = useState(Math.round((inicial?.mobilizacao ?? MOBILIZACAO) * 100));
  const salvar = useMutation({
    mutationFn: () => source.salvarAnaliseTerritorial({ id: inicial?.id, titulo: titulo_.trim(), uf, cd_cargo: cargo,
      candidatura_principal_id: principal!.id, candidatura_adversaria_id: adversaria!.id, cd_municipio: municipio,
      mobilizacao: mobilizacao / 100 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["analises-territoriais", uf] }),
  });
  const cargos = [...new Set(base.candidaturas.filter((c) => c.tipo === "nominal").map((c) => c.cargo))].sort((a, b) => a - b);
  const validos = principal && adversaria && principal.id !== adversaria.id && principal.cargo === cargo && adversaria.cargo === cargo
    && principal.eleicao === adversaria.eleicao;
  const trocarCargo = (n: number) => { setCargo(n); setPrincipal(null); setAdversaria(null); };
  return (
    <div className="flex flex-col gap-4">
      <form className="grid gap-3 rounded-lg border border-line bg-panel p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (validos && titulo_.trim()) salvar.mutate(); }}>
        <label className="flex flex-col gap-1 text-sm text-muted">{L("Título", "Title")}<input value={titulo_} maxLength={120} required onChange={(e) => setTitulo(e.target.value)} className="rounded-md border border-line bg-bg px-3 py-2 text-ink" /></label>
        <label className="flex flex-col gap-1 text-sm text-muted">{L("Cargo", "Office")}<select value={cargo} onChange={(e) => trocarCargo(Number(e.target.value))} className="rounded-md border border-line bg-bg px-3 py-2 text-ink">{cargos.map((c) => <option key={c} value={c}>{CARGOS[c]}</option>)}</select></label>
        <div className="text-sm text-muted">{L("Candidato principal", "Main candidate")}<CandidatePicker id="principal" base={base} cargo={cargo} onPick={setPrincipal} />{principal && <div className="mt-1 text-ink">{nomeCand(principal)} · {principal.partido}</div>}</div>
        <div className="text-sm text-muted">{L("Adversário", "Opponent")}<CandidatePicker id="adversaria" base={base} cargo={cargo} onPick={setAdversaria} />{adversaria && <div className="mt-1 text-ink">{nomeCand(adversaria)} · {adversaria.partido}</div>}</div>
        <MunicipioSelect base={base} value={municipio} onChange={setMunicipio} id="municipio-mobilizacao" />
        <label className="flex flex-col gap-1 text-sm text-muted">{L("Mobilização simulada", "Simulated turnout gain")}<input type="number" min={1} max={100} value={mobilizacao} onChange={(e) => setMobilizacao(Math.min(100, Math.max(1, Number(e.target.value))))} className="rounded-md border border-line bg-bg px-3 py-2 text-ink" /><span>%</span></label>
        {principal?.id === adversaria?.id && <p className="text-sm text-danger">{L("Escolha candidatos diferentes.", "Choose different candidates.")}</p>}
        {principal && adversaria && principal.eleicao !== adversaria.eleicao && <p className="text-sm text-danger">{L("As candidaturas pertencem a eleições diferentes.", "The candidacies belong to different elections.")}</p>}
        {salvar.error && <ErrorBox error={salvar.error} />}
        <div className="flex gap-2 md:col-span-2"><button type="submit" disabled={!validos || !titulo_.trim() || salvar.isPending} className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-40">{L("Salvar para a equipe", "Save for team")}</button></div>
      </form>
      {validos && <Analise base={base} principal={principal} adversaria={adversaria} mobilizacao={mobilizacao / 100} municipio={municipio} />}
    </div>
  );
}

function AnalisesSalvas({ base, uf }: { base: Base; uf: string }) {
  const q = useQuery({ queryKey: ["analises-territoriais", uf], queryFn: () => source.analisesTerritoriais() });
  const admin = useSouAdmin();
  const me = useQuery({ queryKey: ["usuario-atual"], queryFn: async () => isDev ? "dev" : (await supabase().auth.getUser()).data.user?.id ?? null, staleTime: Infinity });
  const qc = useQueryClient();
  const [aberta, setAberta] = useState<AnaliseTerritorial | null>(null);
  const apagar = useMutation({ mutationFn: (id: string) => source.apagarAnaliseTerritorial(id), onSuccess: () => { setAberta(null); void qc.invalidateQueries({ queryKey: ["analises-territoriais", uf] }); } });
  if (q.error) return <ErrorBox error={q.error} />;
  if (q.isLoading) return <Loading />;
  if (aberta) {
    const principal = base.candById.get(aberta.candidatura_principal_id), adversaria = base.candById.get(aberta.candidatura_adversaria_id);
    const podeEditar = aberta.autor === me.data;
    const podeExcluir = podeEditar || admin.data;
    return <div className="flex flex-col gap-3"><button className="self-start text-accent" onClick={() => setAberta(null)}>← {L("Voltar às análises", "Back to analyses")}</button>
      {podeEditar ? <EditorAnalise base={base} uf={uf} inicial={aberta} /> : principal && adversaria
        ? <Analise base={base} principal={principal} adversaria={adversaria} mobilizacao={Number(aberta.mobilizacao)} municipio={aberta.cd_municipio} />
        : <ErrorBox error={L("Candidaturas da análise não encontradas.", "Analysis candidacies not found.")} />}
      {podeExcluir && <button className="self-start text-danger" onClick={() => apagar.mutate(aberta.id)}>{L("Excluir análise", "Delete analysis")}</button>}{apagar.error && <ErrorBox error={apagar.error} />}</div>;
  }
  return <section className="flex flex-col gap-3"><h1 className="display text-3xl">{L("Análises salvas", "Saved analyses")}</h1>{!q.data?.length && <p className="text-muted">{L("Nenhuma análise salva.", "No saved analyses.")}</p>}<ul className="grid gap-2 md:grid-cols-2">{q.data?.map((a) => <li key={a.id}><button className="w-full rounded-lg border border-line bg-panel p-4 text-left hover:bg-accent-soft" onClick={() => setAberta(a)}><b>{a.titulo}</b><div className="text-sm text-muted">{CARGOS[a.cd_cargo]} · {pct(Number(a.mobilizacao), 0)}</div></button></li>)}</ul></section>;
}

function Painel({ base, lula, adv, votos, totais, mobilizacao, municipio, predefinida }: {
  base: Base; lula: Candidatura; adv: Candidatura; votos: Record<number, VotosCols>; totais: TotaisCols;
  mobilizacao: number; municipio: string | null; predefinida: boolean;
}) {
  const { info, uf } = useUf();
  const vazio = { local: [], votos: [] };
  const vl = votos[lula.id] ?? vazio, va = votos[adv.id] ?? vazio;
  const nomePrincipal = titulo(lula.nome);
  const nomeAdv = titulo(adv.nome);

  // locais (unidade mínima) para o cálculo da meta
  const porLocal = useMemo(() => {
    const m = new Map<number, Terr>();
    totais.local.forEach((id, i) => m.set(id, { chave: String(id), cidade: "", cd: "", locais: 1, aptos: totais.aptos[i], comp: totais.comparecimento[i], validos: totais.validos[i], lula: 0, adv: 0 }));
    vl.local.forEach((id, i) => { const t = m.get(id); if (t) t.lula += vl.votos[i]; });
    va.local.forEach((id, i) => { const t = m.get(id); if (t) t.adv += va.votos[i]; });
    return [...m.values()];
  }, [totais, vl, va]);
  const estado = useMemo(() => porLocal.reduce((a, t) => ({ ...a, aptos: a.aptos + t.aptos, comp: a.comp + t.comp, validos: a.validos + t.validos, lula: a.lula + t.lula, adv: a.adv + t.adv }),
    { chave: uf, cidade: info.nome, cd: "", locais: porLocal.length, aptos: 0, comp: 0, validos: 0, lula: 0, adv: 0 } as Terr), [porLocal, uf, info]);
  const medianaAbst = useMemo(() => {
    const xs = porLocal.filter((t) => t.aptos).map((t) => (t.aptos - t.comp) / t.aptos).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  }, [porLocal]);

  const cidades = useMemo(() => [...agrega(base, totais, vl, va, false).values()].map((t) => linha(t, medianaAbst, mobilizacao)), [base, totais, vl, va, medianaAbst, mobilizacao]);
  const bairros = useMemo(() => [...agrega(base, totais, vl, va, true).values()].filter((t) => t.aptos >= 500).map((t) => linha(t, medianaAbst, mobilizacao)), [base, totais, vl, va, medianaAbst, mobilizacao]);

  // meta: quanto da abstenção nos locais onde Lula venceu fecha a diferença
  const E = linha(estado, medianaAbst, mobilizacao);
  const dif = estado.adv - estado.lula; // > 0: Lula atrás
  const saldoTotal = porLocal.reduce((a, t) => { const x = linha(t, medianaAbst, mobilizacao); return x.margem > 0 ? a + x.saldo / mobilizacao : a; }, 0);
  const abstLula = porLocal.reduce((a, t) => (t.lula > t.adv ? a + t.aptos - t.comp : a), 0);
  const precisa = dif > 0 && saldoTotal > 0 ? dif / saldoTotal : null;

  const positivos = cidades.filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo);
  const somaPos = positivos.reduce((a, c) => a + c.saldo, 0);
  const top5 = positivos.slice(0, 5);
  const top5Share = somaPos ? top5.reduce((a, c) => a + c.saldo, 0) / somaPos : 0;
  const capital = [...cidades].sort((a, b) => b.aptos - a.aptos)[0];
  const bairrosCap = bairros.filter((b) => b.cd === capital?.cd && b.saldo > 0).sort((a, b) => b.saldo - a.saldo).slice(0, 5);
  const disputa = cidades.filter((c) => c.faixa === "disputar").sort((a, b) => b.abst - a.abst).slice(0, 5);
  const faixas = (["mobilizar", "disputar", "conter"] as Faixa[]).map((f) => ({ f, n: cidades.filter((c) => c.faixa === f).length, abst: cidades.filter((c) => c.faixa === f).reduce((a, c) => a + c.abst, 0) }));

  const leitura: ReactNode[] = [];
  leitura.push(L(
    <><b>Ponto de partida:</b> {nomePrincipal} {pct(E.sL, 1)} × {nomeAdv} {pct(E.sA, 1)} dos válidos {dif > 0 ? <>({fmt(dif)} votos atrás)</> : <>({fmt(-dif)} votos à frente)</>}. Abstenção de {pct(E.taxaAbst, 1)}: {fmt(E.abst)} eleitores não votaram.</>,
    <><b>Starting point:</b> {nomePrincipal} {pct(E.sL, 1)} × {nomeAdv} {pct(E.sA, 1)} of valid votes {dif > 0 ? <>({fmt(dif)} votes behind)</> : <>({fmt(-dif)} votes ahead)</>}. Abstention {pct(E.taxaAbst, 1)}: {fmt(E.abst)} voters stayed home.</>));
  leitura.push(precisa == null
    ? L(<><b>A meta:</b> {nomePrincipal} já está à frente; a tarefa é ampliar e proteger a vantagem trazendo de volta parte dos {fmt(abstLula)} abstencionistas dos locais onde venceu.</>,
      <><b>The goal:</b> {nomePrincipal} already leads; the task is to widen and protect the lead by bringing back part of the {fmt(abstLula)} abstainers in the polling places won.</>)
    : precisa <= 1
      ? L(<><b>A meta:</b> nos locais em que {nomePrincipal} venceu, {fmt(abstLula)} eleitores se abstiveram. Se <b>{pct(precisa, 0)}</b> deles repetirem o padrão local, a diferença fecha.</>,
        <><b>The goal:</b> in polling places won by {nomePrincipal}, {fmt(abstLula)} voters abstained. If <b>{pct(precisa, 0)}</b> repeat the local pattern, the gap closes.</>)
      : L(<><b>A meta:</b> mesmo mobilizando todos os {fmt(abstLula)} abstencionistas dos locais favoráveis, o saldo cobre {pct(1 / precisa, 0)} da diferença. A virada exige também persuasão.</>,
        <><b>The goal:</b> even mobilizing all {fmt(abstLula)} abstainers in favourable places covers {pct(1 / precisa, 0)} of the gap. Turning it around also requires persuasion.</>));
  if (top5.length) leitura.push(L(
    <><b>Prioridade 1 (mobilizar):</b> {top5.map((c) => c.cidade).join(", ")} concentram {pct(top5Share, 0)} do saldo potencial. Com {pct(mobilizacao, 0)} de mobilização, rendem {fmt(Math.round(top5.reduce((a, c) => a + c.saldo, 0)))} votos líquidos para {nomePrincipal}.</>,
    <><b>Priority 1 (mobilize):</b> {top5.map((c) => c.cidade).join(", ")} hold {pct(top5Share, 0)} of the potential. At {pct(mobilizacao, 0)} turnout gain, they yield {fmt(Math.round(top5.reduce((a, c) => a + c.saldo, 0)))} net votes for {nomePrincipal}.</>));
  if (bairrosCap.length) leitura.push(L(
    <><b>Em {capital.cidade}:</b> os bairros com maior saldo são {bairrosCap.map((b) => `${b.bairro} (${fmt(Math.round(b.saldo))})`).join(", ")}. Porta a porta, transporte e mutirão de título/comparecimento nesses territórios.</>,
    <><b>In {capital.cidade}:</b> the neighbourhoods with the largest potential are {bairrosCap.map((b) => `${b.bairro} (${fmt(Math.round(b.saldo))})`).join(", ")}. Door-to-door, transport and turnout drives there.</>));
  if (disputa.length) leitura.push(L(
    <><b>Prioridade 2 (disputar):</b> cidades com margem de até 10 p.p. e muita abstenção: {disputa.map((c) => `${c.cidade} (${c.margem >= 0 ? "+" : ""}${dec(c.margem * 100, 1)} p.p.)`).join(", ")}. Aqui mobilizar não basta: precisa de persuasão (economia, Bolsa Família, salário mínimo) e presença de lideranças locais.</>,
    <><b>Priority 2 (contest):</b> cities within 10 pp and high abstention: {disputa.map((c) => `${c.cidade} (${c.margem >= 0 ? "+" : ""}${dec(c.margem * 100, 1)} pp)`).join(", ")}. Mobilization alone is not enough: persuasion (economy, cash transfers, minimum wage) and local leaders are needed.</>));
  leitura.push(L(
    <><b>Não gastar energia em:</b> {faixas[2].n} cidades onde {nomeAdv} venceu por mais de 10 p.p. (faixa "conter"): mobilizar ali aumenta o saldo dele. Comunicação defensiva, não campanha de comparecimento.</>,
    <><b>Don't spend energy on:</b> {faixas[2].n} cities where {nomeAdv} won by more than 10 pp ("contain" band): turnout drives there help him. Defensive messaging, not turnout campaigns.</>));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="eyebrow">{predefinida ? L(`Estratégia de virada · ${info.nome} · 2º turno presidencial`, `Turnaround strategy · ${info.nome} · presidential runoff`) : L(`Análise territorial · ${municipio ? titulo(base.munByCd.get(municipio)?.nome ?? "") : info.nome} · ${CARGOS[lula.cargo]}`, `Territorial analysis · ${municipio ? titulo(base.munByCd.get(municipio)?.nome ?? "") : info.nome} · ${CARGOS[lula.cargo]}`)}</div>
        <h1 className="display text-4xl md:text-5xl">{predefinida ? L("Mapa de Mobilização", "Mobilization Map") : `${nomePrincipal} × ${nomeAdv}`}</h1>
      </header>

      <section aria-label={L("Leitura", "Reading")} className="rounded-lg border-2 border-accent/60 bg-panel p-4">
        <h2 className="eyebrow mb-2 text-accent">{L("Plano de virada", "Turnaround plan")}</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">{leitura.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">
          {L(`Simulação, não previsão: saldo potencial = ${pct(mobilizacao, 0)} dos abstencionistas × (válidos ÷ comparecimento) × (${nomePrincipal} − ${nomeAdv}), supondo que os novos votantes repitam o padrão do território. Faixas: "mobilizar" = ${nomePrincipal} à frente; "disputar" = margem menor que 10 p.p.; "conter" = ${nomeAdv} à frente por 10 p.p. ou mais.`,
            `Simulation, not a forecast: potential = ${pct(mobilizacao, 0)} of abstainers × (valid ÷ turnout) × (${nomePrincipal} − ${nomeAdv}), assuming new voters repeat the territory's voting pattern. Bands: "mobilize" = ${nomePrincipal} ahead; "contest" = margin below 10 pp; "contain" = ${nomeAdv} ahead by 10 pp or more.`)}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {faixas.map(({ f, n, abst }) => (
          <div key={f} className="rounded-lg border border-line bg-panel p-3">
            <div className="eyebrow">{NOME_FAIXA(f)}</div>
            <div className="num text-2xl font-bold">{fmt(n)} <span className="text-sm font-normal text-muted">{L("cidades", "cities")}</span></div>
            <div className="text-xs text-muted">{fmt(abst)} {L("abstenções", "abstentions")}</div>
          </div>
        ))}
      </div>

      <Mapa base={base} cidades={cidades} nomePrincipal={nomePrincipal} />
      <TabelaTerr titulo={L(`Prioridades por cidade — saldo potencial para ${nomePrincipal} com ${pct(mobilizacao, 0)} de mobilização`, `Priorities by city — potential net votes for ${nomePrincipal} with ${pct(mobilizacao, 0)} turnout gain`)}
        linhas={cidades} nomePrincipal={nomePrincipal} nomeAdv={nomeAdv} mobilizacao={mobilizacao} arquivo={`mapa_mobilizacao_${lula.numero}_cidades`} />
      <TabelaTerr titulo={L("Prioridades por bairro (todas as cidades; bairros com 500+ eleitores)", "Priorities by neighbourhood (all cities; neighbourhoods with 500+ voters)")}
        linhas={bairros} nomePrincipal={nomePrincipal} nomeAdv={nomeAdv} mobilizacao={mobilizacao} arquivo={`mapa_mobilizacao_${lula.numero}_bairros`} bairro />

      <Nossas base={base} bairros={bairros} nomePrincipal={nomePrincipal} mobilizacao={mobilizacao} />
    </div>
  );
}

function Mapa({ base, cidades, nomePrincipal }: { base: Base; cidades: Linha[]; nomePrincipal: string }) {
  const rampa = RAMPA();
  const porCd = useMemo(() => new Map(cidades.map((c) => [c.cd, c])), [cidades]);
  // mediana dos saldos positivos e dos negativos (em módulo): separa "alto" de "baixo" de cada lado
  const cortes = useMemo(() => {
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    return { pos: med(cidades.filter((c) => c.saldo > 0).map((c) => c.saldo)), neg: med(cidades.filter((c) => c.saldo < 0).map((c) => -c.saldo)) };
  }, [cidades]);
  const cor = useCallback((cd: string): RGB | null => {
    const c = porCd.get(cd);
    if (!c || !c.validos) return null;
    if (c.saldo > 0) return rampa[c.saldo >= cortes.pos ? 4 : 3];
    if (c.saldo < 0) return rampa[-c.saldo >= cortes.neg ? 0 : 1];
    return rampa[2];
  }, [porCd, cortes, rampa]);
  const info = useCallback(({ municipio }: { municipio?: string }) => {
    const c = municipio ? porCd.get(municipio) : undefined;
    return c ? `${nomePrincipal}: ${pct(c.sL, 1)} · ${L("saldo potencial", "potential")} ${c.saldo > 0 ? "+" : ""}${fmt(Math.round(c.saldo))} · ${L("abstenção", "abstention")} ${pct(c.taxaAbst, 1)} · ${NOME_FAIXA(c.faixa)}` : null;
  }, [porCd]);
  const vazio = useMemo<PorLocal>(() => ({ votos: new Float64Array(base.locais.length), validos: new Float64Array(base.locais.length), total: 0, totalValidos: 0 }), [base]);
  return (
    <section aria-label={L("Mapa de prioridades", "Priority map")} className="flex flex-col gap-2">
      <h2 className="display text-2xl">{L("Onde está o voto a buscar", "Where the votes are")}</h2>
      <LazyMap base={base} dados={vazio} municipio={null} modo="municipios" metrica="pct" corPorMunicipio={cor} infoExtra={info} rotuloSerie={L("votos", "votes")} altura="min(62vh, 620px)" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={L("Legenda", "Legend")}>
        {[L("saldo negativo alto (mobilizar ajuda o adversário)", "large negative (turnout helps the opponent)"), L("saldo negativo baixo", "small negative"),
          L("empate / sem votos", "even / no votes"), L("saldo positivo baixo", "small positive"), L("saldo positivo alto (prioridade)", "large positive (priority)")].map((t, i) => (
          <span key={t} className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm" style={{ background: cssRgb(rampa[i]) }} />{t}</span>
        ))}
        <span>{L("Alto/baixo: acima ou abaixo da mediana das cidades do mesmo sinal.", "Large/small: above or below the median of cities with the same sign.")}</span>
      </div>
    </section>
  );
}

function TabelaTerr({ titulo: tit, linhas, nomePrincipal, nomeAdv, mobilizacao, arquivo, bairro = false }: { titulo: string; linhas: Linha[]; nomePrincipal: string; nomeAdv: string; mobilizacao: number; arquivo: string; bairro?: boolean }) {
  const [faixa, setFaixa] = useState<"todas" | Faixa>("todas");
  const dados = useMemo(() => (faixa === "todas" ? linhas : linhas.filter((l) => l.faixa === faixa)), [linhas, faixa]);
  const columns = useMemo<ColumnDef<Linha, unknown>[]>(() => [
    ...(bairro ? [{ id: "bairro", accessorKey: "bairro", header: L("Bairro", "Neighbourhood"), cell: (x: { getValue: () => unknown }) => <span className="font-semibold">{String(x.getValue())}</span> } as ColumnDef<Linha, unknown>] : []),
    { id: "cidade", accessorKey: "cidade", header: L("Cidade", "City"), cell: (x) => <span className={bairro ? "" : "font-semibold"}>{String(x.getValue())}</span> },
    { id: "aptos", accessorKey: "aptos", header: L("Eleitores", "Voters"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "abst", accessorKey: "abst", header: L("Abstenções", "Abstentions"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "taxaAbst", accessorKey: "taxaAbst", header: L("Abstenção", "Abstention"), cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "sL", accessorKey: "sL", header: nomePrincipal, cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "sA", accessorKey: "sA", header: nomeAdv, cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "saldo", accessorKey: "saldo", header: L("Saldo potencial", "Potential"), cell: (x) => {
      const v = Math.round(Number(x.getValue()));
      return <span className={v > 0 ? "font-semibold text-accent" : "text-muted"}>{v > 0 ? "+" : ""}{fmt(v)}</span>;
    }, meta: { numeric: true } },
    { id: "faixa", accessorFn: (l) => NOME_FAIXA(l.faixa), header: L("Faixa", "Band") },
  ], [bairro, nomePrincipal, nomeAdv]);
  const exportCols: ExportCol<Linha>[] = [
    ...(bairro ? [{ header: L("Bairro", "Neighbourhood"), value: (l: Linha) => l.bairro ?? "" }] : []),
    { header: L("Cidade", "City"), value: (l) => l.cidade }, { header: L("Locais de votação", "Polling places"), value: (l) => l.locais, type: "number" },
    { header: L("Eleitores", "Voters"), value: (l) => l.aptos, type: "number" }, { header: L("Abstenções", "Abstentions"), value: (l) => l.abst, type: "number" },
    { header: L("Taxa de abstenção", "Abstention rate"), value: (l) => l.taxaAbst, type: "percent" },
    { header: `${nomePrincipal} (% válidos)`, value: (l) => l.sL, type: "percent" }, { header: `${nomeAdv} (% válidos)`, value: (l) => l.sA, type: "percent" },
    { header: `${L("Saldo potencial", "Potential")} (${pct(mobilizacao, 0)})`, value: (l) => Math.round(l.saldo), type: "number" }, { header: L("Faixa", "Band"), value: (l) => NOME_FAIXA(l.faixa) },
  ];
  return (
    <section className="flex flex-col gap-2">
      <Segmented label={L("Faixa", "Band")} value={faixa} onChange={(v) => setFaixa(v as typeof faixa)}
        options={[{ id: "todas", label: L("Todas", "All") }, ...(["mobilizar", "disputar", "conter"] as Faixa[]).map((f) => ({ id: f, label: NOME_FAIXA(f) }))]} />
      <DataTable titulo={tit} data={dados} columns={columns} exportCols={exportCols} nomeArquivo={arquivo}
        busca={(l) => `${l.bairro ?? ""} ${l.cidade}`} initialSort={[{ id: "saldo", desc: true }]} pageSize={15}
        atalhos={[
          { label: L("Maior saldo", "Largest potential"), sort: [{ id: "saldo", desc: true }] },
          { label: L("Mais abstenções", "Most abstentions"), sort: [{ id: "abst", desc: true }] },
          { label: L("Maior taxa de abstenção", "Highest abstention rate"), sort: [{ id: "taxaAbst", desc: true }] },
          { label: `${nomePrincipal} ${L("mais forte", "strongest")}`, sort: [{ id: "sL", desc: true }] },
        ]} />
    </section>
  );
}

// ---- onde nossas candidaturas podem atuar ----

function Nossas({ base, bairros, nomePrincipal, mobilizacao }: { base: Base; bairros: Linha[]; nomePrincipal: string; mobilizacao: number }) {
  const cands = useCandidaturasAcompanhadas(base);
  if (!cands.length) return null;
  return (
    <section aria-label={L("Onde nossas candidaturas podem atuar", "Where our candidacies can act")} className="flex flex-col gap-3">
      <h2 className="display text-2xl">{L("Onde nossas candidaturas podem atuar", "Where our candidacies can act")}</h2>
      <p className="text-sm text-muted">
        {L(`Cruzamento entre a base eleitoral de cada candidatura e o saldo potencial para ${nomePrincipal}.`, `Cross-reference between each candidacy's electoral base and ${nomePrincipal}'s potential.`)}
      </p>
      {cands.map((c) => <Nossa key={c.id} base={base} c={c} bairros={bairros} nomePrincipal={nomePrincipal} mobilizacao={mobilizacao} />)}
    </section>
  );
}

function Nossa({ base, c, bairros, nomePrincipal, mobilizacao }: { base: Base; c: Candidatura; bairros: Linha[]; nomePrincipal: string; mobilizacao: number }) {
  const { linhas: todas, loading } = useBaseCandidatura(base, c, bairros);
  const linhas = useMemo(() => (todas ?? []).filter((b) => b.saldo > 0), [todas]);
  const columns = useMemo<ColumnDef<LinhaNossa, unknown>[]>(() => [
    { id: "bairro", accessorKey: "bairro", header: L("Bairro", "Neighbourhood"), cell: (x) => <span className="font-semibold">{String(x.getValue())}</span> },
    { id: "cidade", accessorKey: "cidade", header: L("Cidade", "City") },
    { id: "votosC", accessorKey: "votosC", header: L("Votos da candidatura", "Candidacy votes"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "indice", accessorKey: "indice", header: L("Força relativa", "Relative strength"), cell: (x) => `${dec(Number(x.getValue()), 1)}×`, meta: { numeric: true } },
    { id: "abst", accessorKey: "abst", header: L("Abstenções", "Abstentions"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "sL", accessorKey: "sL", header: nomePrincipal, cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "saldo", accessorKey: "saldo", header: L("Saldo potencial", "Potential"), cell: (x) => <span className="font-semibold text-accent">+{fmt(Math.round(Number(x.getValue())))}</span>, meta: { numeric: true } },
    { id: "score", accessorKey: "score", header: L("Prioridade", "Priority"), cell: (x) => fmt(Math.round(Number(x.getValue()))), meta: { numeric: true } },
  ], [nomePrincipal]);
  const exportCols: ExportCol<LinhaNossa>[] = [
    { header: L("Bairro", "Neighbourhood"), value: (l) => l.bairro ?? "" }, { header: L("Cidade", "City"), value: (l) => l.cidade },
    { header: L("Votos da candidatura", "Candidacy votes"), value: (l) => l.votosC, type: "number" }, { header: L("Força relativa", "Relative strength"), value: (l) => l.indice, type: "number" },
    { header: L("Abstenções", "Abstentions"), value: (l) => l.abst, type: "number" }, { header: `${nomePrincipal} (% válidos)`, value: (l) => l.sL, type: "percent" },
    { header: `${L("Saldo potencial", "Potential")} (${pct(mobilizacao, 0)})`, value: (l) => Math.round(l.saldo), type: "number" }, { header: L("Prioridade", "Priority"), value: (l) => Math.round(l.score), type: "number" },
  ];
  const top = [...linhas].sort((a, b) => b.score - a.score).slice(0, 5);
  const somaSaldo = linhas.reduce((a, l) => a + l.saldo, 0);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <h3 className="text-lg font-semibold"><Link className="hover:text-accent" to={`/c/${c.id}`}>{titulo(c.nome)}</Link> <span className="text-sm font-normal text-muted">{c.partido} · {CARGOS[c.cargo]} · {fmt(c.votos)} {L("votos", "votes")}</span></h3>
      {loading ? <Loading /> : !linhas.length ? <p className="text-sm text-muted">{L("Sem bairros que combinem base forte e saldo positivo.", "No neighbourhoods combining a strong base and positive potential.")}</p> : (
        <>
          <p className="text-sm">
            {L(<>{fmt(linhas.length)} bairros combinam base forte da candidatura e saldo positivo para {nomePrincipal}, somando <b>+{fmt(Math.round(somaSaldo))}</b> votos líquidos com {pct(mobilizacao, 0)} de mobilização. Começar por: {top.map((b) => `${b.bairro} (${b.cidade})`).join(", ")}.</>,
              <>{fmt(linhas.length)} neighbourhoods combine a strong candidacy base and positive potential for {nomePrincipal}, adding <b>+{fmt(Math.round(somaSaldo))}</b> net votes at {pct(mobilizacao, 0)} turnout gain. Start with: {top.map((b) => `${b.bairro} (${b.cidade})`).join(", ")}.</>)}
          </p>
          <DataTable titulo={L(`${titulo(c.nome)}: bairros de atuação prioritária no 2º turno`, `${titulo(c.nome)}: priority neighbourhoods for the runoff`)} data={linhas} columns={columns} exportCols={exportCols}
            nomeArquivo={`mapa_mobilizacao_${c.numero}`} busca={(l) => `${l.bairro} ${l.cidade}`} initialSort={[{ id: "score", desc: true }]} pageSize={10}
            atalhos={[
              { label: L("Prioridade", "Priority"), sort: [{ id: "score", desc: true }] },
              { label: L("Base mais forte", "Strongest base"), sort: [{ id: "indice", desc: true }] },
              { label: L("Maior saldo", "Largest potential"), sort: [{ id: "saldo", desc: true }] },
            ]} />
          <p className="text-xs text-muted">{L("Força relativa = % dos válidos da candidatura no bairro ÷ % no estado (só bairros com 1,2× ou mais e 100+ votos). Prioridade = saldo potencial × força relativa (limitada a 3×).",
            "Relative strength = candidacy's % of valid votes in the neighbourhood ÷ its % statewide (only 1.2× or more and 100+ votes). Priority = potential × relative strength (capped at 3×).")}</p>
        </>
      )}
    </div>
  );
}

function GerenciarAcompanhadas({ base }: { base: Base }) {
  const admin = useSouAdmin();
  const { uf } = useUf();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["candidaturas-acompanhadas", uf], queryFn: () => source.candidaturasAcompanhadas() });
  const [selecionada, setSelecionada] = useState<Candidatura | null>(null);
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["candidaturas-acompanhadas", uf] });
  const adicionar = useMutation({ mutationFn: () => source.salvarCandidaturaAcompanhada(selecionada!.id, (q.data?.length ?? 0) + 1), onSuccess: () => { setSelecionada(null); atualizar(); } });
  const remover = useMutation({ mutationFn: (id: number) => source.removerCandidaturaAcompanhada(id), onSuccess: atualizar });
  const mover = useMutation({ mutationFn: async ({ indice, delta }: { indice: number; delta: number }) => {
    const itens = [...(q.data ?? [])].sort((a, b) => a.ordem - b.ordem), destino = indice + delta;
    if (!itens[indice] || !itens[destino]) return;
    await Promise.all([source.salvarCandidaturaAcompanhada(itens[indice].candidatura_id, destino + 1), source.salvarCandidaturaAcompanhada(itens[destino].candidatura_id, indice + 1)]);
  }, onSuccess: atualizar });
  if (!admin.data) return null;
  const atuais = [...(q.data ?? [])].sort((a, b) => a.ordem - b.ordem).map((x) => ({ ...x, candidatura: base.candById.get(x.candidatura_id) })).filter((x) => x.candidatura);
  return (
    <details className="rounded-lg border border-line bg-panel p-4">
      <summary className="cursor-pointer font-semibold">{L("Administrar candidaturas acompanhadas", "Manage tracked candidacies")}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <CandidatePicker id="acompanhada" base={base} onPick={setSelecionada} />
        {selecionada && <div className="flex items-center gap-2"><span>{nomeCand(selecionada)} · {selecionada.partido}</span><button className="rounded-md bg-accent px-3 py-1 text-panel" onClick={() => adicionar.mutate()} disabled={adicionar.isPending}>{L("Adicionar", "Add")}</button></div>}
        <ul className="flex flex-col gap-1">{atuais.map((x, i) => <li key={x.candidatura_id} className="flex items-center justify-between gap-2 border-b border-line py-2"><span>{nomeCand(x.candidatura!)} · {x.candidatura!.partido}</span><span className="flex gap-2"><button disabled={i === 0} onClick={() => mover.mutate({ indice: i, delta: -1 })} aria-label={L("Mover para cima", "Move up")}>↑</button><button disabled={i === atuais.length - 1} onClick={() => mover.mutate({ indice: i, delta: 1 })} aria-label={L("Mover para baixo", "Move down")}>↓</button><button className="text-danger" onClick={() => remover.mutate(x.candidatura_id)}>{L("Remover", "Remove")}</button></span></li>)}</ul>
        {(q.error || adicionar.error || remover.error || mover.error) && <ErrorBox error={q.error ?? adicionar.error ?? remover.error ?? mover.error} />}
      </div>
    </details>
  );
}
