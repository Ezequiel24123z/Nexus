"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity, Blocks, Bot, Braces, ChevronRight, CircleDot, Clock3, Command,
  Cpu, Database, FileText, Globe2, Layers3, LockKeyhole, Network, Plus,
  RefreshCw, Route, Search, SendHorizontal, Settings2, ShieldCheck,
  Sparkles, Terminal, Trash2, Workflow, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Model = { id: string; name: string; context_length?: number | null };
type Connector = {
  id: number; name: string; endpoint: string; method: string;
  authMode: string; description: string;
};
type AgentMessage = {
  id: string; role: "operator" | "nexus"; content: string; meta?: string;
  pending?: boolean; needsConfig?: boolean;
};

const initialModels: Model[] = [
  { id: "openai/gpt-5.2", name: "GPT-5.2", context_length: 400000 },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", context_length: 200000 },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", context_length: 1000000 },
];

const toolCatalog = [
  { id: "web", label: "Web intelligence", detail: "Búsqueda viva y fuentes", icon: Globe2, defaultOn: true },
  { id: "context-compression", label: "Context compression", detail: "Ventana larga sin ruido", icon: Layers3, defaultOn: true },
  { id: "file-parser", label: "Document analyst", detail: "PDFs y archivos", icon: FileText, defaultOn: false },
  { id: "response-healing", label: "Output guard", detail: "JSON y reintentos", icon: ShieldCheck, defaultOn: true },
];

const navItems = [
  { id: "console", label: "Mission control", icon: Command },
  { id: "connectors", label: "Conectores", icon: Network },
  { id: "memory", label: "Memoria", icon: Database },
];

function prettyModel(model: Model) {
  const context = model.context_length ? `${Math.round(model.context_length / 1000)}k` : "variable";
  return `${model.name} · ${context}`;
}

function newMessage(role: AgentMessage["role"], content: string, extras: Partial<AgentMessage> = {}): AgentMessage {
  return { id: `${role}-${Date.now()}-${Math.random()}`, role, content, ...extras };
}

export default function Home() {
  const [view, setView] = useState("console");
  const [models, setModels] = useState<Model[]>(initialModels);
  const [model, setModel] = useState(initialModels[0].id);
  const [catalogSource, setCatalogSource] = useState("catálogo base");
  const [draft, setDraft] = useState("Diseña un plan de producto para lanzar una API B2B. Investiga el mercado, identifica riesgos y prepara una secuencia de acciones que pueda aprobar.");
  const [mode, setMode] = useState<"execute" | "plan" | "structured">("execute");
  const [activeTools, setActiveTools] = useState<string[]>(toolCatalog.filter((tool) => tool.defaultOn).map((tool) => tool.id));
  const [isRunning, setIsRunning] = useState(false);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorNotice, setConnectorNotice] = useState("");
  const [connectorDialogOpen, setConnectorDialogOpen] = useState(false);
  const [connectorForm, setConnectorForm] = useState({ name: "", endpoint: "", method: "GET", authMode: "none", secretRef: "", description: "" });
  const [isSavingConnector, setIsSavingConnector] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryNotice, setMemoryNotice] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([
    newMessage(
      "nexus",
      "Control operativo preparado. Puedo investigar, planificar y ejecutar llamadas aprobadas. Elige un modelo, habilita capacidades y describe la misión.",
      { meta: "Sistema listo · aprobaciones activas" },
    ),
  ]);

  const currentModel = useMemo(() => models.find((item) => item.id === model) ?? models[0], [model, models]);

  useEffect(() => {
    void refreshModels();
    void loadConnectors();
  }, []);

  async function refreshModels() {
    try {
      const response = await fetch("/api/models");
      const data = (await response.json()) as { models?: Model[]; source?: string };
      if (data.models?.length) {
        setModels(data.models);
        setModel((selected) => (data.models?.some((entry) => entry.id === selected) ? selected : data.models![0]!.id));
      }
      setCatalogSource(data.source === "openrouter" ? "catálogo en directo" : "catálogo base");
    } catch {
      setCatalogSource("catálogo base");
    }
  }

  async function loadConnectors() {
    try {
      const response = await fetch("/api/connectors");
      const data = (await response.json()) as { connectors?: Connector[]; unavailable?: string };
      setConnectors(data.connectors ?? []);
      if (data.unavailable) setConnectorNotice(data.unavailable);
    } catch {
      setConnectorNotice("No se pudieron cargar los conectores todavía.");
    }
  }

  function toggleTool(id: string, enabled: boolean) {
    setActiveTools((tools) => enabled ? [...new Set([...tools, id])] : tools.filter((tool) => tool !== id));
  }

  async function runMission(event?: FormEvent) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isRunning) return;
    setIsRunning(true);
    setMessages((items) => [
      ...items,
      newMessage("operator", prompt, { meta: `${currentModel?.name ?? model} · ${mode === "plan" ? "Plan" : mode === "structured" ? "Estructurado" : "Ejecutar"}` }),
      newMessage("nexus", "Analizando la misión y verificando las capacidades disponibles…", { pending: true, meta: "NEXUS en ejecución" }),
    ]);
    setDraft("");

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model, mode, plugins: activeTools, temperature: 0.3 }),
      });
      const data = (await response.json()) as { content?: string; error?: string; model?: string; status?: string; usage?: { total_tokens?: number } | null };
      const content = data.content || data.error || "La misión terminó sin respuesta.";
      const meta = data.status === "needs_configuration"
        ? "Configuración pendiente · la clave permanece en el servidor"
        : `${data.model ?? model}${data.usage?.total_tokens ? ` · ${data.usage.total_tokens.toLocaleString()} tokens` : ""}`;
      setMessages((items) => items.map((item) => item.pending ? newMessage("nexus", content, { meta, needsConfig: data.status === "needs_configuration" }) : item));
    } catch {
      setMessages((items) => items.map((item) => item.pending ? newMessage("nexus", "No se pudo contactar el runtime de NEXUS. Reintenta la misión.", { meta: "Error recuperable" }) : item));
    } finally {
      setIsRunning(false);
    }
  }

  async function saveConnector(event: FormEvent) {
    event.preventDefault();
    setIsSavingConnector(true);
    setConnectorNotice("");
    try {
      const response = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connectorForm),
      });
      const data = (await response.json()) as { connector?: Connector; error?: string };
      if (!response.ok || !data.connector) throw new Error(data.error || "No se pudo crear el conector.");
      setConnectors((items) => [data.connector!, ...items]);
      setConnectorForm({ name: "", endpoint: "", method: "GET", authMode: "none", secretRef: "", description: "" });
      setConnectorDialogOpen(false);
      setConnectorNotice(`${data.connector.name} está listo para una prueba controlada.`);
    } catch (error) {
      setConnectorNotice(error instanceof Error ? error.message : "No se pudo crear el conector.");
    } finally {
      setIsSavingConnector(false);
    }
  }

  async function testConnector(connector: Connector) {
    setConnectorNotice(`Probando ${connector.name}…`);
    try {
      const response = await fetch(`/api/connectors/${connector.id}/invoke`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: {} }),
      });
      const data = (await response.json()) as { ok?: boolean; status?: number; error?: string };
      setConnectorNotice(data.ok ? `${connector.name} respondió correctamente (${data.status}).` : data.error || `${connector.name} respondió con estado ${data.status}.`);
    } catch {
      setConnectorNotice(`No se pudo probar ${connector.name}.`);
    }
  }

  async function deleteConnector(connector: Connector) {
    try {
      await fetch(`/api/connectors/${connector.id}`, { method: "DELETE" });
      setConnectors((items) => items.filter((item) => item.id !== connector.id));
      setConnectorNotice(`${connector.name} se eliminó de este espacio.`);
    } catch {
      setConnectorNotice("No se pudo eliminar el conector.");
    }
  }

  async function saveMemory() {
    const content = memoryDraft.trim();
    if (!content) return;
    try {
      const response = await fetch("/api/memory", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar.");
      setMemoryDraft("");
      setMemoryNotice("Contexto guardado para futuras misiones.");
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : "No se pudo guardar el contexto.");
    }
  }

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" className="border-r border-white/8 bg-[#070a11]">
        <SidebarHeader className="p-3">
          <div className="flex h-11 items-center gap-3 rounded-xl px-2 text-white">
            <span className="grid size-7 place-items-center rounded-lg bg-[#d7ff47] text-[#071016] shadow-[0_0_28px_rgba(215,255,71,.25)]"><Sparkles className="size-4" /></span>
            <span className="font-display text-sm font-semibold tracking-[0.18em]">NEXUS</span>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Workspace</SidebarGroupLabel>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton isActive={view === item.id} tooltip={item.label} onClick={() => setView(item.id)} className="text-slate-300 data-[active=true]:bg-white/10 data-[active=true]:text-white hover:bg-white/6 hover:text-white">
                    <item.icon /> <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Operadores</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton tooltip="Flujos" className="text-slate-400 hover:bg-white/6 hover:text-white"><Workflow /><span>Flujos</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton tooltip="Registros" className="text-slate-400 hover:bg-white/6 hover:text-white"><Terminal /><span>Registros</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton tooltip="Políticas" className="text-slate-400 hover:bg-white/6 hover:text-white"><ShieldCheck /><span>Políticas</span></SidebarMenuButton></SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <button className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/4 p-2 text-left text-xs text-slate-300 transition hover:bg-white/8">
            <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-[#6ee7f9] to-[#8876ff] text-[10px] font-bold text-[#0a0e16]">EO</span>
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><span className="block truncate font-medium text-white">Operator</span><span className="block truncate text-[10px] text-slate-500">Owner workspace</span></span>
            <Settings2 className="size-4 text-slate-500 group-data-[collapsible=icon]:hidden" />
          </button>
        </SidebarFooter>
      </Sidebar>

      <main className="min-w-0 flex-1 bg-[#0a0f18] text-slate-100">
        <header className="flex h-16 items-center justify-between border-b border-white/7 px-4 md:px-7">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="text-slate-300 hover:bg-white/7 hover:text-white" />
            <div className="hidden h-5 w-px bg-white/10 sm:block" />
            <div className="flex items-center gap-2 text-sm text-slate-400"><CircleDot className="size-3.5 text-[#d7ff47]" /><span className="hidden sm:inline">NEXUS / </span><span className="text-white">{view === "console" ? "Mission control" : view === "connectors" ? "Connector fabric" : "Context memory"}</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-[#d7ff47]/20 bg-[#d7ff47]/7 px-2.5 py-1 text-[11px] font-medium text-[#d7ff47] sm:inline-flex">Private workspace</span>
            <Button variant="ghost" size="icon-sm" className="text-slate-400 hover:bg-white/7 hover:text-white"><Search /></Button>
            <Button variant="ghost" size="icon-sm" className="text-slate-400 hover:bg-white/7 hover:text-white"><Settings2 /></Button>
          </div>
        </header>

        <Tabs value={view} onValueChange={setView} className="h-[calc(100svh-4rem)]">
          <TabsContent value="console" className="m-0 h-full">
            <div className="grid h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <section className="flex min-h-0 flex-col border-r border-white/7">
                <div className="border-b border-white/7 px-5 py-6 md:px-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.17em] text-[#d7ff47]"><span className="size-1.5 rounded-full bg-[#d7ff47]" /> Agentic operator</p>
                      <h1 className="font-display text-2xl font-medium tracking-tight text-white md:text-3xl">Turn intent into <span className="text-[#6ee7f9]">controlled action.</span></h1>
                      <p className="mt-2 text-sm text-slate-400">Un modelo. Muchas capacidades. Un rastro claro de cada decisión.</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.035] px-3 py-2 text-xs text-slate-400"><Activity className="size-3.5 text-[#6ee7f9]" /><span>Runtime</span><span className="font-medium text-white">ready</span></div>
                  </div>
                </div>

                <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-6 md:px-8">
                  <div className="mx-auto flex max-w-3xl flex-col gap-5">
                    {messages.map((message) => (
                      <article key={message.id} className={`group flex gap-3 ${message.role === "operator" ? "justify-end" : "justify-start"}`}>
                        {message.role === "nexus" && <div className={`mt-1 grid size-8 shrink-0 place-items-center rounded-lg ${message.pending ? "animate-pulse bg-[#6ee7f9]/15 text-[#6ee7f9]" : "bg-[#d7ff47] text-[#081019]"}`}><Bot className="size-4" /></div>}
                        <div className={`max-w-[90%] rounded-2xl border px-4 py-3.5 ${message.role === "operator" ? "border-[#6ee7f9]/22 bg-[#132535] text-slate-100" : "border-white/8 bg-white/[.035] text-slate-200"} ${message.needsConfig ? "border-amber-300/25 bg-amber-300/[.06]" : ""}`}>
                          <p className={`whitespace-pre-wrap text-sm leading-6 ${message.pending ? "text-slate-400" : ""}`}>{message.content}</p>
                          {message.meta && <p className="mt-2 border-t border-white/7 pt-2 text-[11px] font-medium text-slate-500">{message.meta}</p>}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <form onSubmit={runMission} className="border-t border-white/7 bg-[#0b111b]/75 px-5 py-4 backdrop-blur md:px-8 md:py-5">
                  <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-[#101827] p-2 shadow-[0_18px_80px_rgba(0,0,0,.18)] transition focus-within:border-[#6ee7f9]/45">
                    <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Describe una misión…" className="min-h-22 resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-6 text-white placeholder:text-slate-600 focus-visible:ring-0" />
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={model} onValueChange={setModel}>
                          <SelectTrigger className="h-8 max-w-52 border-white/10 bg-white/[.045] text-xs text-slate-200 hover:bg-white/[.07]"><Bot className="size-3.5 text-[#6ee7f9]" /><SelectValue placeholder="Modelo" /></SelectTrigger>
                          <SelectContent className="max-h-80 border-white/10 bg-[#121a27] text-slate-100">
                            {models.map((item) => <SelectItem key={item.id} value={item.id} className="focus:bg-white/10 focus:text-white">{prettyModel(item)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                          <SelectTrigger className="h-8 w-30 border-white/10 bg-white/[.045] text-xs text-slate-300 hover:bg-white/[.07]"><SelectValue /></SelectTrigger>
                          <SelectContent className="border-white/10 bg-[#121a27] text-slate-100"><SelectItem value="execute">Ejecutar</SelectItem><SelectItem value="plan">Plan</SelectItem><SelectItem value="structured">JSON</SelectItem></SelectContent>
                        </Select>
                        <span className="hidden text-[11px] text-slate-600 sm:inline">{activeTools.length} capacidades</span>
                      </div>
                      <Button type="submit" disabled={!draft.trim() || isRunning} className="h-8 rounded-lg bg-[#d7ff47] px-3 text-xs font-bold text-[#071016] hover:bg-[#e4ff82] disabled:bg-slate-700 disabled:text-slate-400">{isRunning ? <RefreshCw className="size-3.5 animate-spin" /> : <SendHorizontal className="size-3.5" />}{isRunning ? "Procesando" : "Ejecutar"}</Button>
                    </div>
                  </div>
                  <p className="mx-auto mt-2 max-w-3xl pl-2 text-[11px] text-slate-600">Las acciones que modifican sistemas externos requieren tu aprobación explícita.</p>
                </form>
              </section>

              <aside className="hidden min-h-0 overflow-y-auto bg-[#080d15] xl:block">
                <div className="border-b border-white/7 p-5">
                  <div className="mb-4 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Capability mesh</p><Button variant="ghost" size="icon-xs" onClick={refreshModels} className="text-slate-500 hover:bg-white/8 hover:text-white"><RefreshCw /></Button></div>
                  <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[.035] p-3"><div><p className="text-xs font-medium text-white">{currentModel?.name ?? "Modelo"}</p><p className="mt-0.5 text-[11px] text-slate-500">{catalogSource}</p></div><CpuChip /></div>
                </div>
                <div className="p-5">
                  <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Herramientas</p><span className="text-[11px] text-[#d7ff47]">{activeTools.length} live</span></div>
                  <div className="space-y-2">
                    {toolCatalog.map((tool) => <div key={tool.id} className="flex items-center gap-3 rounded-xl border border-white/7 bg-white/[.025] p-3"><span className="grid size-8 place-items-center rounded-lg bg-white/[.055] text-[#6ee7f9]"><tool.icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{tool.label}</p><p className="truncate text-[11px] text-slate-500">{tool.detail}</p></div><Switch checked={activeTools.includes(tool.id)} onCheckedChange={(checked) => toggleTool(tool.id, checked)} aria-label={`Activar ${tool.label}`} className="data-[state=checked]:bg-[#d7ff47]" /></div>)}
                  </div>
                </div>
                <div className="mx-5 mb-5 rounded-2xl border border-[#6ee7f9]/15 bg-gradient-to-br from-[#6ee7f9]/10 to-transparent p-4"><div className="mb-3 flex items-center gap-2 text-[#6ee7f9]"><LockKeyhole className="size-4" /><span className="text-xs font-semibold">Safety envelope</span></div><p className="text-xs leading-5 text-slate-400">Claves aisladas en servidor. Los conectores solo aceptan HTTPS público. Tus confirmaciones gobiernan escrituras y envíos.</p><button onClick={() => setView("connectors")} className="mt-3 flex items-center gap-1 text-xs font-medium text-white hover:text-[#d7ff47]">Revisar políticas <ChevronRight className="size-3.5" /></button></div>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="connectors" className="m-0 h-full overflow-y-auto">
            <div className="mx-auto max-w-5xl px-5 py-7 md:px-10 md:py-10">
              <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.17em] text-[#d7ff47]">Connector fabric</p><h2 className="font-display text-3xl tracking-tight text-white">Conecta sistemas, no secretos.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Crea endpoints REST reutilizables. NEXUS guarda la definición y obtiene las credenciales desde el entorno en el momento de ejecutar.</p></div><Button onClick={() => setConnectorDialogOpen(true)} className="rounded-xl bg-[#d7ff47] font-bold text-[#071016] hover:bg-[#e4ff82]"><Plus /> Nuevo conector</Button></div>
              <div className="mb-6 grid gap-3 md:grid-cols-3"><Metric icon={Route} label="Patrón" value="REST · HTTPS" /><Metric icon={LockKeyhole} label="Credenciales" value="Server-only" /><Metric icon={ShieldCheck} label="Protección" value="Approval gate" /></div>
              {connectorNotice && <p className="mb-5 rounded-xl border border-white/8 bg-white/[.035] px-4 py-3 text-sm text-slate-300">{connectorNotice}</p>}
              <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0d1420]">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-white/7 px-5 py-4"><div><p className="text-sm font-semibold text-white">Conectores del espacio</p><p className="mt-1 text-xs text-slate-500">Prueba una llamada de solo lectura antes de ofrecerla a un agente.</p></div><span className="self-center rounded-full bg-white/[.06] px-2 py-1 text-[11px] text-slate-400">{connectors.length}</span></div>
                {connectors.length === 0 ? <div className="grid min-h-64 place-items-center p-8 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[.025] text-[#6ee7f9]"><Network className="size-5" /></span><p className="mt-4 text-sm font-medium text-white">Tu fabric está vacío.</p><p className="mt-1 text-sm text-slate-500">Añade GitHub, Notion, CRM propio o cualquier API HTTPS.</p><Button variant="outline" onClick={() => setConnectorDialogOpen(true)} className="mt-4 border-white/12 bg-transparent text-slate-200 hover:bg-white/8 hover:text-white">Crear primer conector</Button></div></div> : <div className="divide-y divide-white/7">{connectors.map((connector) => <div key={connector.id} className="flex flex-wrap items-center gap-4 px-5 py-4"><span className="grid size-10 place-items-center rounded-xl bg-[#6ee7f9]/10 text-[#6ee7f9]"><Braces className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-white">{connector.name}</p><span className="rounded bg-white/[.07] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{connector.method}</span>{connector.authMode !== "none" && <span className="flex items-center gap-1 text-[10px] text-[#d7ff47]"><LockKeyhole className="size-3" /> Secret ref</span>}</div><p className="mt-1 truncate text-xs text-slate-500">{connector.endpoint}</p>{connector.description && <p className="mt-1 text-xs text-slate-400">{connector.description}</p>}</div><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => testConnector(connector)} className="border-white/10 bg-transparent text-slate-300 hover:bg-white/7 hover:text-white"><Zap /> Probar</Button><Button variant="ghost" size="icon-sm" onClick={() => deleteConnector(connector)} className="text-slate-500 hover:bg-red-500/10 hover:text-red-300"><Trash2 /></Button></div></div>)}</div>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="memory" className="m-0 h-full overflow-y-auto">
            <div className="mx-auto max-w-5xl px-5 py-7 md:px-10 md:py-10"><div className="mb-8"><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.17em] text-[#d7ff47]">Persistent context</p><h2 className="font-display text-3xl tracking-tight text-white">Memoria con intención.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Guarda contexto estable que NEXUS debe recordar entre misiones: tu producto, restricciones, tono, decisiones y reglas.</p></div><div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-white/8 bg-[#0d1420] p-5"><div className="mb-4 flex items-center gap-2"><Database className="size-4 text-[#6ee7f9]" /><h3 className="font-medium text-white">Añadir un bloque de contexto</h3></div><Textarea value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="Ej.: Nuestro producto debe cumplir GDPR, el público principal son equipos de operaciones y no podemos enviar datos de clientes a servicios externos sin aprobación…" className="min-h-40 border-white/10 bg-white/[.025] text-slate-100 placeholder:text-slate-600 focus-visible:ring-[#6ee7f9]/30" /><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Se guarda como contexto del operador.</span><Button onClick={saveMemory} disabled={!memoryDraft.trim()} className="bg-[#d7ff47] text-[#071016] hover:bg-[#e4ff82]"><Database /> Guardar memoria</Button></div>{memoryNotice && <p className="mt-4 rounded-lg bg-white/[.045] px-3 py-2 text-sm text-slate-300">{memoryNotice}</p>}</div><div className="space-y-3"><InfoCard icon={Sparkles} title="Memoria selectiva" text="Elige qué es reutilizable; no escondas decisiones importantes dentro de un prompt." /><InfoCard icon={ShieldCheck} title="Perímetro seguro" text="Las políticas del espacio mandan incluso cuando el modelo propone una acción." /><InfoCard icon={Clock3} title="Trazabilidad" text="Las misiones guardadas conservan modelo, estado, entrada y resultado." /></div></div></div>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={connectorDialogOpen} onOpenChange={setConnectorDialogOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto border-white/10 bg-[#101827] text-slate-100 sm:max-w-xl">
          <DialogHeader><DialogTitle className="font-display text-xl text-white">Nuevo conector REST</DialogTitle><DialogDescription className="leading-5 text-slate-400">NEXUS guardará la definición. Las claves se configuran como secretos de entorno y nunca viajan al navegador.</DialogDescription></DialogHeader>
          <form onSubmit={saveConnector} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="connector-name" className="text-slate-300">Nombre</Label><Input id="connector-name" required value={connectorForm.name} onChange={(event) => setConnectorForm((form) => ({ ...form, name: event.target.value }))} placeholder="GitHub Issues" className="border-white/10 bg-white/[.035] text-white placeholder:text-slate-600" /></div><div className="grid gap-2"><Label className="text-slate-300">Método</Label><Select value={connectorForm.method} onValueChange={(value) => setConnectorForm((form) => ({ ...form, method: value }))}><SelectTrigger className="w-full border-white/10 bg-white/[.035] text-white"><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#121a27] text-white"><SelectItem value="GET">GET · lectura</SelectItem><SelectItem value="POST">POST · acción</SelectItem></SelectContent></Select></div></div>
            <div className="grid gap-2"><Label htmlFor="connector-endpoint" className="text-slate-300">Endpoint HTTPS</Label><Input id="connector-endpoint" required type="url" value={connectorForm.endpoint} onChange={(event) => setConnectorForm((form) => ({ ...form, endpoint: event.target.value }))} placeholder="https://api.example.com/v1/issues" className="border-white/10 bg-white/[.035] text-white placeholder:text-slate-600" /><p className="text-[11px] text-slate-500">Se bloquean destinos locales y redes privadas.</p></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label className="text-slate-300">Autenticación</Label><Select value={connectorForm.authMode} onValueChange={(value) => setConnectorForm((form) => ({ ...form, authMode: value }))}><SelectTrigger className="w-full border-white/10 bg-white/[.035] text-white"><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#121a27] text-white"><SelectItem value="none">Sin clave</SelectItem><SelectItem value="bearer">Bearer token</SelectItem><SelectItem value="api_key">X-API-Key</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="connector-secret" className="text-slate-300">Referencia de secreto</Label><Input id="connector-secret" disabled={connectorForm.authMode === "none"} value={connectorForm.secretRef} onChange={(event) => setConnectorForm((form) => ({ ...form, secretRef: event.target.value.toUpperCase() }))} placeholder="CONNECTOR_GITHUB_TOKEN" className="border-white/10 bg-white/[.035] font-mono text-xs text-white placeholder:text-slate-600 disabled:opacity-35" /></div></div>
            <div className="grid gap-2"><Label htmlFor="connector-description" className="text-slate-300">Descripción para el agente <span className="text-slate-600">opcional</span></Label><Textarea id="connector-description" value={connectorForm.description} onChange={(event) => setConnectorForm((form) => ({ ...form, description: event.target.value }))} placeholder="Consulta incidencias abiertas del equipo de plataforma." className="min-h-20 border-white/10 bg-white/[.035] text-white placeholder:text-slate-600" /></div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setConnectorDialogOpen(false)} className="text-slate-400 hover:bg-white/7 hover:text-white">Cancelar</Button><Button type="submit" disabled={isSavingConnector} className="bg-[#d7ff47] font-bold text-[#071016] hover:bg-[#e4ff82]">{isSavingConnector ? <RefreshCw className="animate-spin" /> : <Plus />} Guardar conector</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Route; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[.03] p-4"><span className="grid size-9 place-items-center rounded-lg bg-white/[.055] text-[#6ee7f9]"><Icon className="size-4" /></span><div><p className="text-[11px] uppercase tracking-[.12em] text-slate-500">{label}</p><p className="mt-0.5 text-sm font-medium text-white">{value}</p></div></div>;
}

function InfoCard({ icon: Icon, title, text }: { icon: typeof Sparkles; title: string; text: string }) {
  return <div className="rounded-2xl border border-white/8 bg-white/[.025] p-4"><Icon className="size-4 text-[#d7ff47]" /><p className="mt-3 text-sm font-medium text-white">{title}</p><p className="mt-1 text-sm leading-5 text-slate-500">{text}</p></div>;
}

function CpuChip() {
  return <span className="grid size-9 place-items-center rounded-lg bg-[#6ee7f9]/10 text-[#6ee7f9]"><Cpu className="size-4" /></span>;
}
