import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PaineisProntos } from "../components/PaineisProntos";
import { CandidatePicker, ErrorBox, Loading, SituacaoBadge, nomeCand } from "../components/ui";
import { useSouAdmin } from "../lib/acessos";
import { useBase, type Base } from "../lib/data";
import { fmt, dec, titulo } from "../lib/format";
import { L } from "../lib/i18n";
import { source } from "../lib/source";
import { CARGOS, type Candidatura } from "../lib/types";
import { deUf, useUf } from "../lib/uf";

const LIMITE_DESTAQUES = 6;

function useDestaquesVisaoGeral(uf: string) {
  return useQuery({
    queryKey: ["destaques-visao-geral", uf],
    queryFn: () => source.destaquesVisaoGeral(uf),
    staleTime: 30_000,
  });
}

export function Overview() {
  const base = useBase();
  const navigate = useNavigate();
  const { uf, info } = useUf();
  const admin = useSouAdmin();
  const destaquesQuery = useDestaquesVisaoGeral(uf);
  const b = base.data;

  if (base.error) return <ErrorBox error={base.error} />;
  if (destaquesQuery.error) return <ErrorBox error={destaquesQuery.error} />;
  if (admin.error) return <ErrorBox error={admin.error} />;
  if (!b || destaquesQuery.isLoading || admin.isLoading) return <Loading />;

  const ids = [...(destaquesQuery.data ?? [])].sort((a, b_) => a.ordem - b_.ordem).map((x) => x.candidatura_id);
  const destaques = ids.map((id) => b.candById.get(id)).filter((c): c is Candidatura => !!c);
  const configurado = destaques.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="eyebrow">{L(`Estado ${deUf(info)} · 1º turno · 4 de outubro de 2026`, `State of ${info.nome} · 1st round · October 4, 2026`)}</div>
        <h1 className="display text-4xl">{L(`Visão geral ${deUf(info)}`, `Overview of ${info.nome}`)}</h1>
      </header>

      {admin.data === true && <EditorDestaques base={b} uf={uf} idsIniciais={ids} />}

      {!configurado ? (
        <section className="rounded-lg border border-line bg-panel p-6" role="status">
          <h2 className="display text-xl">{L("Destaques ainda não configurados", "Highlights not configured yet")}</h2>
          <p className="mt-2 text-muted">
            {admin.data
              ? L("Selecione até 6 candidaturas no editor acima para carregar a Visão Geral.", "Select up to 6 candidacies above to load the Overview.")
              : L("Um administrador precisa selecionar as candidaturas em destaque desta UF.", "An administrator must select the featured candidacies for this state.")}
          </p>
        </section>
      ) : (
        <>
          <section aria-label={L("Candidaturas em destaque", "Featured candidacies")} className="grid gap-4 md:grid-cols-2">
            {destaques.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`} className="rounded-lg border border-line bg-panel p-5 hover:border-accent">
                <div className="eyebrow">{CARGOS[c.cargo]} · {c.partido}</div>
                <div className="display mt-1 text-2xl">{nomeCand(c)}<SituacaoBadge c={c} /></div>
                <div className="mt-3 flex items-baseline gap-2">
                  <b className="display num text-3xl">{fmt(c.votos)}</b>
                  <span className="text-muted">{L("votos no estado", "votes in the state")}</span>
                </div>
                <div className="mt-3 text-sm text-accent">{L("Abrir painel →", "Open panel →")}</div>
              </Link>
            ))}
          </section>

          {info.sigla === "MG" && <CardDigital />}
          <Senado base={b} destaques={destaques} />
          <PaineisProntos />

          <section aria-label={L("Buscar candidatura", "Search candidacy")} className="flex flex-col gap-2">
            <h2 className="display text-xl">{L("Qualquer candidatura", "Any candidacy")}</h2>
            <div className="max-w-xl">
              <CandidatePicker base={b} onPick={(c) => navigate(`/c/${c.id}`)}
                placeholder={L("Abrir o painel de qualquer candidatura (todos os partidos)…", "Open the panel of any candidacy (all parties)…")} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EditorDestaques({ base, uf, idsIniciais }: { base: Base; uf: string; idsIniciais: number[] }) {
  const qc = useQueryClient();
  const assinatura = idsIniciais.join(",");
  const [ids, setIds] = useState(idsIniciais);
  const [aviso, setAviso] = useState("");
  const [confirmarLimpeza, setConfirmarLimpeza] = useState(false);

  useEffect(() => {
    setIds(idsIniciais);
    setConfirmarLimpeza(false);
  }, [uf, assinatura]);

  const salvar = useMutation({
    mutationFn: (novosIds: number[]) => source.substituirDestaquesVisaoGeral(uf, novosIds),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["destaques-visao-geral", uf] });
      setAviso(L("Destaques salvos.", "Highlights saved."));
      setConfirmarLimpeza(false);
    },
  });

  const candidaturas = ids.map((id) => base.candById.get(id)).filter((c): c is Candidatura => !!c);
  const alterado = ids.join(",") !== assinatura;
  const adicionar = (c: Candidatura) => {
    setAviso("");
    if (ids.includes(c.id)) {
      setAviso(L("Essa candidatura já está na lista.", "This candidacy is already in the list."));
      return;
    }
    if (ids.length >= LIMITE_DESTAQUES) {
      setAviso(L("O limite é de 6 candidaturas por UF.", "The limit is 6 candidacies per state."));
      return;
    }
    setIds((atuais) => [...atuais, c.id]);
  };
  const mover = (indice: number, delta: number) => {
    const destino = indice + delta;
    if (destino < 0 || destino >= ids.length) return;
    setIds((atuais) => {
      const proximos = [...atuais];
      [proximos[indice], proximos[destino]] = [proximos[destino], proximos[indice]];
      return proximos;
    });
  };
  const solicitarSalvar = () => {
    setAviso("");
    if (!ids.length && idsIniciais.length && !confirmarLimpeza) {
      setConfirmarLimpeza(true);
      return;
    }
    salvar.mutate(ids);
  };

  return (
    <details className="rounded-lg border border-line bg-panel p-4" open={!idsIniciais.length || undefined}>
      <summary className="cursor-pointer font-semibold">{L("Administrar destaques da Visão Geral", "Manage Overview highlights")}</summary>
      <div className="mt-4 flex flex-col gap-4">
        <div className="max-w-xl">
          <CandidatePicker id="destaque-visao-geral" base={base} somenteNominais onPick={adicionar}
            placeholder={L("Buscar candidatura nominal por nome, número ou partido…", "Search a nominal candidacy by name, number, or party…")} />
        </div>
        <p className="text-xs text-muted">{L(`${ids.length} de ${LIMITE_DESTAQUES} selecionadas. A ordem abaixo será usada nos cards.`, `${ids.length} of ${LIMITE_DESTAQUES} selected. The order below will be used in the cards.`)}</p>
        {candidaturas.length > 0 && (
          <ol className="rounded-lg border border-line">
            {candidaturas.map((c, i) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-0">
                <span className="num w-6 text-right text-sm text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 font-semibold">{nomeCand(c)} · {c.partido} · {CARGOS[c.cargo]}</span>
                <button type="button" disabled={i === 0 || salvar.isPending} onClick={() => mover(i, -1)}
                  aria-label={L(`Mover ${c.nome} para cima`, `Move ${c.nome} up`)} className="px-2 disabled:opacity-30">↑</button>
                <button type="button" disabled={i === candidaturas.length - 1 || salvar.isPending} onClick={() => mover(i, 1)}
                  aria-label={L(`Mover ${c.nome} para baixo`, `Move ${c.nome} down`)} className="px-2 disabled:opacity-30">↓</button>
                <button type="button" disabled={salvar.isPending} onClick={() => setIds((atuais) => atuais.filter((id) => id !== c.id))}
                  className="text-sm text-danger disabled:opacity-50">{L("Remover", "Remove")}</button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {confirmarLimpeza ? (
            <>
              <span className="text-sm font-semibold text-danger">{L("Remover todos os destaques desta UF?", "Remove all highlights from this state?")}</span>
              <button type="button" onClick={solicitarSalvar} disabled={salvar.isPending}
                className="rounded-md bg-danger px-3 py-1.5 font-semibold text-panel disabled:opacity-50">{L("Confirmar limpeza", "Confirm removal")}</button>
              <button type="button" onClick={() => setConfirmarLimpeza(false)} className="text-sm text-muted">{L("Cancelar", "Cancel")}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={solicitarSalvar} disabled={!alterado || salvar.isPending}
                className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-50">
                {salvar.isPending ? L("Salvando…", "Saving…") : L("Salvar destaques", "Save highlights")}
              </button>
              {alterado && <button type="button" onClick={() => setIds(idsIniciais)} className="text-sm text-muted">{L("Descartar alterações", "Discard changes")}</button>}
            </>
          )}
        </div>
        {salvar.error && <ErrorBox error={salvar.error} />}
        {aviso && <p className="text-sm" role="status">{aviso}</p>}
      </div>
    </details>
  );
}

/** Resultado do Senado no estado; destaques do cargo recebem acesso rápido, sem preferência partidária. */
function Senado({ base, destaques }: { base: Base; destaques: Candidatura[] }) {
  const sen = useMemo(
    () => base.candidaturas.filter((c) => c.cargo === 5 && c.tipo === "nominal").sort((a, b) => b.votos - a.votos),
    [base],
  );
  if (!sen.length) return null;
  const validos = base.candidaturas.filter((c) => c.cargo === 5 && c.destinacao?.startsWith("Válido")).reduce((a, c) => a + c.votos, 0)
    || sen.reduce((a, c) => a + c.votos, 0);
  const focos = sen.filter((c) => destaques.some((d) => d.id === c.id));
  const max = sen[0].votos || 1;
  return (
    <section aria-label={L("Senado", "Senate")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-2xl">{L("Senado", "Senate")}</h2>
        <div className="flex flex-wrap gap-2">
          {focos.map((c) => (
            <Link key={c.id} to={`/c/${c.id}`}
              className="rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
              {L("Análise completa", "Full analysis")} · {titulo(c.nome)} ({c.partido}) →
            </Link>
          ))}
        </div>
      </div>
      <ol className="rounded-lg border border-line bg-panel">
        {sen.map((c, i) => (i >= 10 && !focos.includes(c) ? null : (
          <li key={c.id}>
            <Link to={`/c/${c.id}`}
              className={`grid grid-cols-[24px_minmax(0,1fr)_minmax(60px,180px)_auto_auto] items-center gap-3 border-b border-line px-3 py-1.5 last:border-0 hover:bg-accent-soft ${focos.includes(c) ? "bg-accent-soft" : ""}`}>
              <span className="num text-right text-xs text-muted">{i + 1}</span>
              <span className="truncate"><b>{nomeCand(c)}</b> <span className="text-sm text-muted">{c.partido}</span><SituacaoBadge c={c} compacto /></span>
              <span className="h-2 rounded-sm bg-accent/70" style={{ width: `${(100 * c.votos) / max}%` }} aria-hidden />
              <span className="num text-right text-sm">{fmt(c.votos)}</span>
              <span className="num w-16 text-right text-sm text-muted">{validos ? dec((100 * c.votos) / validos, 2) : "–"}%</span>
            </Link>
          </li>
        )))}
      </ol>
      <p className="text-xs text-muted">{sen.length > 10 ? L(`Os 10 mais votados de ${sen.length}. `, `Top 10 of ${sen.length}. `) : ""}{L("Cada eleitor votou em 2 nomes: as porcentagens dos válidos somam 200%. Clique numa candidatura para ver a análise do Senado do ponto de vista dela.", "Each voter chose 2 names: the % of valid votes add up to 200%. Click a candidacy to see the Senate analysis from its point of view.")}</p>
    </section>
  );
}

function CardDigital() {
  const d = useQuery({ queryKey: ["digital", "MG"], queryFn: () => source.digital(), staleTime: 5 * 60_000 });
  const n = d.data ? new Set(d.data.perfis.map((p) => p.candidatura_id).filter(Boolean)).size : null;
  if (d.data && !n) return null;
  return (
    <Link to="/digital-mg" className="block rounded-lg border border-line bg-panel p-5 hover:border-accent"
      aria-label={L("Abrir o painel Evolução digital e votação", "Open the Digital growth and votes panel")}>
      <div className="eyebrow">{L("Redes sociais × urnas · Deputado Estadual", "Social media × ballots · State Deputy")}</div>
      <div className="display mt-1 text-2xl">{L("Evolução digital e votação", "Digital growth and votes")}</div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        {L(
          `${n != null ? `${n} candidaturas acompanhadas desde setembro` : "Candidaturas acompanhadas desde setembro"}: seguidores no Instagram e no X ao longo da campanha e no snapshot atual, postagens no Instagram e a votação de cada uma no 1º turno.`,
          `${n != null ? `${n} candidates tracked since September` : "Candidates tracked since September"}: Instagram and X followers throughout the campaign and in the current snapshot, Instagram posts and each one's votes in the 1st round.`,
        )}
      </p>
      <div className="mt-3 text-sm text-accent">{L("Abrir painel →", "Open panel →")}</div>
    </Link>
  );
}
