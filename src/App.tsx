import React, { useState, useEffect, useRef } from 'react';
import type {
  ProcessItem,
  SchedulerAlgorithm,
  PageReplacementAlgorithm,
  Frame,
  ScheduledTask,
  GanttEntry,
} from './types/os';
import { executeClockTick } from './algorithms/engine';
import { getClockHandPointer, resetClockHandPointer } from './algorithms/mmu';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Zap,
  Plus,
  Trash2,
  Cpu,
  Layers,
  Clock,
  Settings,
  ListOrdered,
  Activity,
  ArrowRight,
  ArrowLeft,
  LogOut,
  Power,
  Sparkles,
  BarChart3,
} from 'lucide-react';

const COLORS = ['#2563EB', '#E11D48', '#059669', '#D97706', '#7C3AED', '#0284C7'];

const INITIAL_SCHEDULE: ScheduledTask[] = [
  { id: '1', name: 'Proceso A', burst: 7, pagesCount: 2, arrivalTime: 0, priority: 3, color: '#84CC16' },
  { id: '2', name: 'Proceso B', burst: 5, pagesCount: 3, arrivalTime: 2, priority: 1, color: '#E11D48' },
  { id: '3', name: 'Proceso C', burst: 10, pagesCount: 2, arrivalTime: 2, priority: 4, color: '#2563EB' },
  { id: '4', name: 'Proceso D', burst: 4, pagesCount: 2, arrivalTime: 6, priority: 2, color: '#D97706' },
  { id: '5', name: 'Proceso E', burst: 1, pagesCount: 1, arrivalTime: 7, priority: 5, color: '#059669' },
];

export const ALGORITHM_INFO: Record<
  SchedulerAlgorithm,
  { name: string; icon: string; desc: string }
> = {
  ROUND_ROBIN: {
    name: 'Round Robin (RR)',
    icon: '🔄',
    desc: 'Turnos circulares equitativos con tiempo límite de Quantum.',
  },
  SJF: {
    name: 'Proceso Más Corto (SJF)',
    icon: '⏱️',
    desc: 'Despacha primero al proceso con menor tiempo de ráfaga restante.',
  },
  PRIORITY: {
    name: 'Por Prioridad',
    icon: '⭐',
    desc: 'Despacha el proceso con mayor jerarquía (Prioridad 1 = Máxima).',
  },
  MULTILEVEL_QUEUE: {
    name: 'Multicola (MLQ)',
    icon: '🥞',
    desc: 'Colas separadas por prioridad: Cola Alta (RR), Media (RR) y Baja (FIFO).',
  },
  GUARANTEED: {
    name: 'Planificación Garantizada',
    icon: '⚖️',
    desc: 'Garantiza a cada proceso 1/n de tiempo de CPU desde que llegó.',
  },
  LOTTERY: {
    name: 'Por Sorteo / Lotería',
    icon: '🎟️',
    desc: 'Sorteo aleatorio ponderado según los boletos ganados por prioridad.',
  },
  FIFO: {
    name: 'FIFO / FCFS',
    icon: '➡️',
    desc: 'Primero en llegar, primero en ser atendido sin interrupción.',
  },
};

export const PAGE_REPLACEMENT_INFO: Record<
  PageReplacementAlgorithm,
  { name: string; icon: string; desc: string }
> = {
  CLOCK: {
    name: 'Reloj / Segunda Oportunidad (Clock)',
    icon: '⏰',
    desc: 'Usa una manecilla circular y un bit de referencia (R=1). Da una segunda oportunidad antes de desalojar.',
  },
  LRU: {
    name: 'LRU (Least Recently Used)',
    icon: '🧠',
    desc: 'Desaloja el marco que lleva más tiempo sin ser consultado o accedido por la CPU.',
  },
  FIFO: {
    name: 'FIFO (First-In, First-Out)',
    icon: '➡️',
    desc: 'Desaloja la página más antigua cargada en memoria física en orden estricto de llegada.',
  },
};

export function App() {
  // Navegación por Pantallas: 'CONFIG' (Pantalla 1) | 'TASKS' (Pantalla 2) | 'EMULATOR' (Pantalla 3)
  const [currentScreen, setCurrentScreen] = useState<'CONFIG' | 'TASKS' | 'EMULATOR'>('CONFIG');
  const [showExitModal, setShowExitModal] = useState<boolean>(false);

  // =========================================================================
  // PANTALLA 1: CONFIGURACIÓN DEL SISTEMA OPERATIVO Y MEMORIA RAM
  // =========================================================================
  const [algorithm, setAlgorithm] = useState<SchedulerAlgorithm>('FIFO');
  const [pageReplacement, setPageReplacement] = useState<PageReplacementAlgorithm>('CLOCK');
  const [quantum, setQuantum] = useState<number>(3);
  const [totalFramesCount, setTotalFramesCount] = useState<number>(8);
  const [pageSizeKB, setPageSizeKB] = useState<number>(4);
  const [clockSpeedMs, setClockSpeedMs] = useState<number>(800);

  // =========================================================================
  // PANTALLA 2: LISTA DE TAREAS / PROCESOS (LISTA DETERMINISTA)
  // =========================================================================
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>(INITIAL_SCHEDULE);
  const [newName, setNewName] = useState<string>('Proceso F');
  const [newBurst, setNewBurst] = useState<number>(5);
  const [newPages, setNewPages] = useState<number>(2);
  const [newArrival, setNewArrival] = useState<number>(8);
  const [newPriority, setNewPriority] = useState<number>(3);

  // =========================================================================
  // PANTALLA 3: ESTADO DEL EMULADOR EN VIVO & DIAGRAMA DE GANTT
  // =========================================================================
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentTick, setCurrentTick] = useState<number>(0);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [ganttHistory, setGanttHistory] = useState<GanttEntry[]>([]);
  const [frames, setFrames] = useState<Frame[]>(() =>
    Array.from({ length: 8 }, (_, i) => ({
      id: i,
      processId: null,
      processName: null,
      color: null,
      pageNumber: null,
      referenceBit: 0,
      allocatedAtTick: 0,
      lastAccessTick: 0,
    }))
  );

  // Ref para el loop síncrono
  const stateRef = useRef({
    currentTick,
    processes,
    frames,
    scheduledTasks,
    algorithm,
    pageReplacement,
    quantum,
    totalFramesCount,
    ganttHistory,
  });

  stateRef.current = {
    currentTick,
    processes,
    frames,
    scheduledTasks,
    algorithm,
    pageReplacement,
    quantum,
    totalFramesCount,
    ganttHistory,
  };

  // Actualizar marcos de RAM cuando cambia totalFramesCount
  useEffect(() => {
    resetClockHandPointer();
    setFrames(
      Array.from({ length: totalFramesCount }, (_, i) => ({
        id: i,
        processId: null,
        processName: null,
        color: null,
        pageNumber: null,
        referenceBit: 0,
        allocatedAtTick: 0,
        lastAccessTick: 0,
      }))
    );
  }, [totalFramesCount]);

  /**
   * Ejecutar 1 Tick de Reloj invocando el motor de algoritmos y actualizando Gantt
   */
  const stepClock = () => {
    const result = executeClockTick({
      currentTick: stateRef.current.currentTick,
      processes: stateRef.current.processes,
      frames: stateRef.current.frames,
      scheduledTasks: stateRef.current.scheduledTasks,
      algorithm: stateRef.current.algorithm,
      pageReplacement: stateRef.current.pageReplacement,
      quantum: stateRef.current.quantum,
    });

    // Registrar estado del Diagrama de Gantt para este tick
    const tickStates: Record<string, 'EJECUCION' | 'LISTO' | 'BLOQUEADO' | 'INACTIVO'> = {};
    stateRef.current.scheduledTasks.forEach(task => {
      if (result.executedProcessName === task.name) {
        tickStates[task.name] = 'EJECUCION';
      } else {
        const proc = result.processes.find(
          p => p.name === task.name && (p.state === 'LISTO' || p.state === 'BLOQUEADO')
        );
        if (proc) {
          tickStates[task.name] = proc.state === 'LISTO' ? 'LISTO' : 'BLOQUEADO';
        } else {
          tickStates[task.name] = 'INACTIVO';
        }
      }
    });

    const newGanttEntry: GanttEntry = {
      tick: result.nextTick,
      states: tickStates,
    };

    setCurrentTick(result.nextTick);
    setProcesses(result.processes);
    setFrames(result.frames);
    setGanttHistory(prev => [...prev, newGanttEntry]);
  };

  // Temporizador con setInterval
  useEffect(() => {
    if (!isRunning || currentScreen !== 'EMULATOR') return;
    const interval = setInterval(() => {
      stepClock();
    }, clockSpeedMs);
    return () => clearInterval(interval);
  }, [isRunning, clockSpeedMs, currentScreen]);

  // Controles de reloj
  const togglePlay = () => setIsRunning(prev => !prev);
  const handleStep = () => {
    setIsRunning(false);
    stepClock();
  };

  const handleReset = () => {
    setIsRunning(false);
    setCurrentTick(0);
    resetClockHandPointer();
    setProcesses([]);
    setGanttHistory([]);
    setFrames(
      Array.from({ length: totalFramesCount }, (_, i) => ({
        id: i,
        processId: null,
        processName: null,
        color: null,
        pageNumber: null,
        referenceBit: 0,
        allocatedAtTick: 0,
        lastAccessTick: 0,
      }))
    );
    setSelectedProcessId(null);
  };

  // Función de Salir del Sistema
  const handleConfirmExit = () => {
    setIsRunning(false);
    handleReset();
    setCurrentScreen('CONFIG');
    setShowExitModal(false);
  };

  // Simular interrupción I/O
  const triggerIO = (targetId?: string) => {
    setProcesses(prev => {
      const target = targetId
        ? prev.find(p => p.id === targetId && (p.state === 'EJECUCION' || p.state === 'LISTO'))
        : prev.find(p => p.state === 'EJECUCION');

      if (!target) return prev;

      return prev.map(p => {
        if (p.id === target.id) {
          return {
            ...p,
            state: 'BLOQUEADO' as const,
            blockedTicks: 3,
            quantumUsed: 0,
          };
        }
        return p;
      });
    });
  };

  // Agregar nueva tarea a la lista de ejecución determinista
  const handleAddSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    const color = COLORS[scheduledTasks.length % COLORS.length];
    const newItem: ScheduledTask = {
      id: `${Date.now()}`,
      name: newName,
      burst: Number(newBurst),
      pagesCount: Number(newPages),
      arrivalTime: Number(newArrival),
      priority: Number(newPriority),
      color,
    };
    setScheduledTasks(prev => [...prev, newItem].sort((a, b) => a.arrivalTime - b.arrivalTime));
    setNewArrival(prev => Number(prev) + 2);
  };

  const removeScheduleItem = (id: string) => {
    setScheduledTasks(prev => prev.filter(item => item.id !== id));
  };

  // Iniciar la emulación desde la pantalla 2
  const startEmulation = () => {
    handleReset();
    setCurrentScreen('EMULATOR');
    setIsRunning(true);
  };

  // Proceso activo o seleccionado para ver su tabla de páginas
  const inspectedProcess = selectedProcessId
    ? processes.find(p => p.id === selectedProcessId)
    : processes.find(p => p.state === 'EJECUCION') || processes[0];

  const currentClockPointer = getClockHandPointer();

  // Número total de columnas para el Diagrama de Gantt (mínimo 30 como en la imagen)
  const totalGanttColumns = Math.max(30, currentTick + 2);
  const ganttTicksArray = Array.from({ length: totalGanttColumns }, (_, i) => i + 1);

  // Lista única de procesos programados
  const uniqueProcessList = Array.from(new Set(scheduledTasks.map(t => t.name)));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans flex flex-col justify-between relative">
      {/* ========================================================================= */}
      {/* MODAL DE CONFIRMACIÓN DE SALIDA */}
      {/* ========================================================================= */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <Power className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">¿Deseas salir del emulador?</h3>
                <p className="text-xs text-slate-400">Esta acción detendrá el reloj y reiniciará la sesión.</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-800">
              Se liberarán los marcos de memoria RAM y regresarás a la pantalla inicial de <strong>Configuración del Sistema Operativo</strong>.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowExitModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmExit}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>Confirmar y Salir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full space-y-6">
        {/* ========================================================================= */}
        {/* HEADER Y NAVEGADOR DE PANTALLAS (PASOS 1, 2 Y 3) */}
        {/* ========================================================================= */}
        <header className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Cpu className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-black text-white">
                  Emulador de Task Manager y MMU
                </h1>
                <p className="text-xs text-slate-400">
                  Planificación de CPU con Diagrama de Gantt y Paginación Virtual de Reloj
                </p>
              </div>
            </div>

            {/* Pestañas de Navegación por Pantallas + Botón Salir */}
            <div className="flex items-center gap-2">
              <nav className="flex items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs font-bold gap-1">
                <button
                  onClick={() => setCurrentScreen('CONFIG')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition ${
                    currentScreen === 'CONFIG'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  <span>1. Config SO</span>
                </button>

                <button
                  onClick={() => setCurrentScreen('TASKS')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition ${
                    currentScreen === 'TASKS'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ListOrdered className="w-4 h-4" />
                  <span>2. Tareas</span>
                </button>

                <button
                  onClick={() => setCurrentScreen('EMULATOR')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition ${
                    currentScreen === 'EMULATOR'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  <span>3. Emulador</span>
                </button>
              </nav>

              {/* Botón Salir en Header */}
              <button
                onClick={() => setShowExitModal(true)}
                className="px-3 py-2 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
                title="Salir y reiniciar el emulador"
              >
                <LogOut className="w-4 h-4 text-rose-400" />
                <span>Salir</span>
              </button>
            </div>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* PANTALLA 1: CONFIGURACIÓN DEL SISTEMA OPERATIVO Y MEMORIA RAM */}
        {/* ========================================================================= */}
        {currentScreen === 'CONFIG' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-400" />
                  PANTALLA 1: CONFIGURACIÓN DE MEMORIA Y ALGORITMOS
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ajusta la capacidad de memoria RAM, marcos de página y selecciona los algoritmos de CPU y MMU.
                </p>
              </div>
              <span className="text-xs bg-blue-500/20 text-blue-300 font-bold px-3 py-1 rounded-full border border-blue-500/30">
                Paso 1 de 3
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
              {/* Sección A: Memoria RAM y MMU */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4">
                <h3 className="font-bold text-sm text-emerald-400 flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  Configuración de Memoria (RAM & MMU)
                </h3>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Cantidad de Marcos de Página en RAM:
                  </label>
                  <select
                    value={totalFramesCount}
                    onChange={e => setTotalFramesCount(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                  >
                    <option value={4}>4 Marcos de RAM</option>
                    <option value={6}>6 Marcos de RAM</option>
                    <option value={8}>8 Marcos de RAM (Estándar)</option>
                    <option value={12}>12 Marcos de RAM</option>
                    <option value={16}>16 Marcos de RAM</option>
                  </select>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Memoria RAM Total: <strong>{totalFramesCount * pageSizeKB} KB</strong> ({totalFramesCount} marcos de {pageSizeKB} KB).
                  </span>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Tamaño de cada Página / Marco:
                  </label>
                  <select
                    value={pageSizeKB}
                    onChange={e => setPageSizeKB(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                  >
                    <option value={2}>2 KB por Página</option>
                    <option value={4}>4 KB por Página (Estándar)</option>
                    <option value={8}>8 KB por Página</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Algoritmo de Reemplazo de Página (MMU):
                  </label>
                  <select
                    value={pageReplacement}
                    onChange={e => setPageReplacement(e.target.value as PageReplacementAlgorithm)}
                    className="w-full bg-slate-900 border border-emerald-500/50 rounded-lg p-2 text-emerald-400 font-bold"
                  >
                    <option value="CLOCK">⏰ Reloj / Segunda Oportunidad (Clock / Second Chance)</option>
                    <option value="LRU">🧠 LRU (Menos usado recientemente)</option>
                    <option value="FIFO">➡️ FIFO (Primero en entrar, primero en salir)</option>
                  </select>
                  <span className="text-[11px] text-emerald-300/90 mt-1 block font-medium">
                    {PAGE_REPLACEMENT_INFO[pageReplacement].desc}
                  </span>
                </div>
              </div>

              {/* Sección B: CPU y Planificador */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4">
                <h3 className="font-bold text-sm text-blue-400 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4" />
                  Planificación de Procesos (Algoritmo de CPU)
                </h3>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Seleccionar Algoritmo de Ejecución:
                  </label>
                  <select
                    value={algorithm}
                    onChange={e => setAlgorithm(e.target.value as SchedulerAlgorithm)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-blue-400 font-bold"
                  >
                    <option value="FIFO">➡️ FIFO / FCFS (Orden de llegada)</option>
                    <option value="ROUND_ROBIN">🔄 Round Robin (Apropiativo por Quantum)</option>
                    <option value="SJF">⏱️ Proceso Más Corto (Shortest Job First / SJF)</option>
                    <option value="PRIORITY">⭐ Por Prioridad (1 = Máxima)</option>
                    <option value="MULTILEVEL_QUEUE">🥞 Multicola / Colas Multinivel (MLQ)</option>
                    <option value="GUARANTEED">⚖️ Planificación Garantizada (Equitativa 1/n)</option>
                    <option value="LOTTERY">🎟️ Planificación por Sorteo / Lotería</option>
                  </select>
                  <span className="text-[11px] text-amber-300/90 mt-1 block font-medium">
                    {ALGORITHM_INFO[algorithm].desc}
                  </span>
                </div>

                {(algorithm === 'ROUND_ROBIN' || algorithm === 'MULTILEVEL_QUEUE') && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Quantum de CPU (Turno límite):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={quantum}
                        onChange={e => setQuantum(Math.max(1, Number(e.target.value)))}
                        className="w-20 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono text-center"
                      />
                      <span className="text-slate-400">ticks de reloj por turno</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Velocidad de Reloj del Simulador:
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Rápido (0.5s)', speed: 500 },
                      { label: 'Normal (0.8s)', speed: 800 },
                      { label: 'Lento (1.2s)', speed: 1200 },
                    ].map(item => (
                      <button
                        key={item.speed}
                        type="button"
                        onClick={() => setClockSpeedMs(item.speed)}
                        className={`p-2 rounded-lg font-medium transition ${
                          clockSpeedMs === item.speed
                            ? 'bg-blue-600 text-white font-bold'
                            : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Botón de Siguiente Pantalla */}
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setCurrentScreen('TASKS')}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
              >
                <span>Siguiente: Configurar Tareas</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PANTALLA 2: LISTA DE TAREAS Y PROCESOS (LISTA DETERMINISTA) */}
        {/* ========================================================================= */}
        {currentScreen === 'TASKS' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="border-b border-slate-800 pb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <ListOrdered className="w-5 h-5 text-blue-400" />
                  PANTALLA 2: LISTA DE PROCESOS Y ALGORITMO DE EJECUCIÓN
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Elige el algoritmo de ejecución para esta lista y agrega las tareas con sus ráfagas de tiempo.
                </p>
              </div>
              <span className="text-xs bg-blue-500/20 text-blue-300 font-bold px-3 py-1 rounded-full border border-blue-500/30">
                Paso 2 de 3
              </span>
            </div>

            {/* Selector de Algoritmo en Pantalla 2 */}
            <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-white font-bold">Algoritmo a usar:</span>
                <select
                  value={algorithm}
                  onChange={e => setAlgorithm(e.target.value as SchedulerAlgorithm)}
                  className="bg-slate-900 border border-blue-700 text-blue-300 font-bold text-xs rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  <option value="FIFO">➡️ FIFO / FCFS</option>
                  <option value="ROUND_ROBIN">🔄 Round Robin</option>
                  <option value="SJF">⏱️ Proceso Más Corto (SJF)</option>
                  <option value="PRIORITY">⭐ Por Prioridad</option>
                  <option value="MULTILEVEL_QUEUE">🥞 Multicola (MLQ)</option>
                  <option value="GUARANTEED">⚖️ Planificación Garantizada</option>
                  <option value="LOTTERY">🎟️ Por Sorteo / Lotería</option>
                </select>
              </div>

              <div className="text-xs text-slate-400">
                {ALGORITHM_INFO[algorithm].desc}
              </div>
            </div>

            {/* Formulario para agregar tarea */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs text-emerald-400 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" />
                  Agregar Nueva Tarea a la Secuencia
                </h3>

                {/* Presets rápidos */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Plantillas de prueba:</span>
                  <button
                    onClick={() => setScheduledTasks(INITIAL_SCHEDULE)}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
                  >
                    Estándar (A, B, C, D, E)
                  </button>
                  <button
                    onClick={() => setScheduledTasks([
                      { id: '1', name: 'Word (1s)', burst: 1, pagesCount: 2, arrivalTime: 0, priority: 3, color: '#84CC16' },
                      { id: '2', name: 'Word (10s)', burst: 10, pagesCount: 2, arrivalTime: 2, priority: 3, color: '#84CC16' },
                      { id: '3', name: 'Chrome (4s)', burst: 4, pagesCount: 3, arrivalTime: 3, priority: 1, color: '#E11D48' },
                    ])}
                    className="px-2 py-1 bg-blue-900/40 hover:bg-blue-900/60 text-blue-300 rounded-lg font-bold"
                  >
                    Word 1s + Word 10s
                  </button>
                </div>
              </div>

              <form onSubmit={handleAddSchedule} className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Nombre:</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="ej. Proceso F"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-medium"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Ráfaga CPU (s):</label>
                  <input
                    type="number"
                    min="1"
                    value={newBurst}
                    onChange={e => setNewBurst(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Páginas RAM:</label>
                  <input
                    type="number"
                    min="1"
                    max="6"
                    value={newPages}
                    onChange={e => setNewPages(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Llegada (\(t\)):</label>
                  <input
                    type="number"
                    min="0"
                    value={newArrival}
                    onChange={e => setNewArrival(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">Prioridad (1-10):</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={newPriority}
                    onChange={e => setNewPriority(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    required
                  />
                </div>
                <div className="col-span-2 sm:col-span-6">
                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/30"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Agregar Tarea a la Lista</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Tabla de tareas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300">
                  Tareas Programadas ({scheduledTasks.length}):
                </span>
                <span className="text-slate-500 font-mono">Ordenadas por instante de llegada (\(t\))</span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">Llegada (\(t\))</th>
                      <th className="p-2.5">Proceso / Instancia</th>
                      <th className="p-2.5">Ráfaga CPU</th>
                      <th className="p-2.5">Páginas Requeridas</th>
                      <th className="p-2.5">Prioridad</th>
                      <th className="p-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                    {scheduledTasks.map(item => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-2.5 font-bold text-emerald-400">t = {item.arrivalTime}</td>
                        <td className="p-2.5 font-bold text-white flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                          <span>{item.name}</span>
                        </td>
                        <td className="p-2.5 text-slate-300">{item.burst}s ({item.burst} ticks)</td>
                        <td className="p-2.5 text-indigo-300">{item.pagesCount} páginas ({item.pagesCount * pageSizeKB} KB)</td>
                        <td className="p-2.5 text-amber-400 font-bold">
                          Nivel {item.priority}
                          <span className="text-[10px] text-slate-500 ml-1">
                            ({item.priority <= 3 ? 'Alta' : item.priority <= 6 ? 'Media' : 'Baja'})
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => removeScheduleItem(item.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 rounded transition"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {scheduledTasks.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-slate-600">
                          No hay tareas en la lista. Agrega una arriba o carga una plantilla.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Botones de Navegación */}
            <div className="pt-2 flex items-center justify-between">
              <button
                onClick={() => setCurrentScreen('CONFIG')}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver a Configuración</span>
              </button>

              <button
                onClick={startEmulation}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl transition shadow-lg shadow-emerald-600/30 flex items-center gap-2"
              >
                <span>Iniciar Emulación en Vivo</span>
                <Play className="w-4 h-4 fill-white" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PANTALLA 3: EMULADOR EN VIVO (TASK MANAGER, GANTT & MMU) */}
        {/* ========================================================================= */}
        {currentScreen === 'EMULATOR' && (
          <div className="space-y-6">
            {/* Barra de Control de Simulación y Selectores en Caliente */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={togglePlay}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-md ${
                    isRunning
                      ? 'bg-amber-600 hover:bg-amber-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
                  <span>{isRunning ? 'Pausar Reloj' : 'Reanudar Reloj'}</span>
                </button>

                <button
                  onClick={handleStep}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition flex items-center gap-1"
                  title="Avanzar 1 tick de reloj"
                >
                  <SkipForward className="w-4 h-4 text-blue-400" />
                  <span>Paso (Step)</span>
                </button>

                <button
                  onClick={handleReset}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-xs font-semibold text-slate-300 hover:text-rose-300 border border-slate-700 transition flex items-center gap-1"
                  title="Reiniciar reloj, Gantt y memoria"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reiniciar</span>
                </button>

                {/* Contador de Reloj */}
                <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl font-mono flex items-center gap-2 text-xs">
                  <Clock className={`w-4 h-4 ${isRunning ? 'text-emerald-400 animate-spin' : 'text-slate-500'}`} />
                  <span className="text-slate-400">TICK:</span>
                  <strong className="text-emerald-400 text-sm">#{currentTick}</strong>
                </div>

                {/* Disparar I/O */}
                <button
                  onClick={() => triggerIO()}
                  className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition flex items-center gap-1.5"
                >
                  <Zap className="w-4 h-4 fill-amber-400" />
                  <span>Forzar I/O</span>
                </button>
              </div>

              {/* Selectores de Algoritmos en Caliente (CPU y MMU) */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
                  <span className="text-slate-400 font-semibold">CPU:</span>
                  <select
                    value={algorithm}
                    onChange={e => setAlgorithm(e.target.value as SchedulerAlgorithm)}
                    className="bg-slate-900 border border-slate-700 text-blue-400 font-bold rounded-lg px-2 py-0.5 focus:outline-none"
                  >
                    <option value="FIFO">➡️ FIFO</option>
                    <option value="ROUND_ROBIN">🔄 Round Robin</option>
                    <option value="SJF">⏱️ SJF</option>
                    <option value="PRIORITY">⭐ Prioridad</option>
                    <option value="MULTILEVEL_QUEUE">🥞 Multicola</option>
                    <option value="GUARANTEED">⚖️ Garantizada</option>
                    <option value="LOTTERY">🎟️ Sorteo</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
                  <span className="text-slate-400 font-semibold">MMU:</span>
                  <select
                    value={pageReplacement}
                    onChange={e => setPageReplacement(e.target.value as PageReplacementAlgorithm)}
                    className="bg-slate-900 border border-slate-700 text-emerald-400 font-bold rounded-lg px-2 py-0.5 focus:outline-none"
                  >
                    <option value="CLOCK">⏰ Reloj (2ª Oport.)</option>
                    <option value="LRU">🧠 LRU</option>
                    <option value="FIFO">➡️ FIFO</option>
                  </select>
                </div>
              </div>

              {/* Botones para volver a editar tareas o Salir */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsRunning(false);
                    setCurrentScreen('TASKS');
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 transition flex items-center gap-1.5"
                >
                  <ListOrdered className="w-4 h-4 text-blue-400" />
                  <span>Editar Tareas</span>
                </button>

                <button
                  onClick={() => {
                    setIsRunning(false);
                    setCurrentScreen('CONFIG');
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 transition flex items-center gap-1.5"
                >
                  <Settings className="w-4 h-4 text-blue-400" />
                  <span>Editar Config</span>
                </button>

                <button
                  onClick={() => setShowExitModal(true)}
                  className="px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition flex items-center gap-1.5"
                  title="Salir de la emulación"
                >
                  <LogOut className="w-4 h-4 text-rose-400" />
                  <span>Salir</span>
                </button>
              </div>
            </div>

            {/* ========================================================================= */}
            {/* DIAGRAMA DE GANTT DE PLANIFICACIÓN DE CPU EN TIEMPO REAL */}
            {/* ========================================================================= */}
            <section className="bg-[#1e293b]/90 border border-slate-700/80 rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-5 h-5 text-lime-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Diagrama de Gantt (Planificación de CPU)
                  </h3>
                </div>

                {/* Leyenda del Diagrama de Gantt */}
                <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 bg-[#84cc16] border border-white/20 rounded-sm shadow-sm" />
                    <span className="text-slate-200">= En ejecución</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 bg-[#facc15] border border-white/20 rounded-sm shadow-sm" />
                    <span className="text-slate-200">= En espera (Listo)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 bg-[#f97316] border border-white/20 rounded-sm shadow-sm" />
                    <span className="text-slate-200">= En espera de E/S (Bloqueado)</span>
                  </div>
                </div>
              </div>

              {/* Matriz del Diagrama de Gantt */}
              <div className="overflow-x-auto pb-2">
                <div className="min-w-fit font-mono text-xs">
                  {/* Fila de números de ticks (1, 2, 3, ... 30) */}
                  <div className="flex items-center mb-1">
                    <div className="w-28 sm:w-32 flex-shrink-0 text-slate-400 font-bold text-right pr-3 font-sans text-xs">
                      Ticks:
                    </div>
                    <div className="flex items-center gap-1">
                      {ganttTicksArray.map(t => (
                        <div
                          key={t}
                          className={`w-6 h-5 flex items-center justify-center text-[10px] font-bold ${
                            t === currentTick ? 'text-lime-400 bg-slate-800 rounded' : 'text-slate-400'
                          }`}
                        >
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Filas por cada proceso (Proceso A, Proceso B, etc.) */}
                  <div className="space-y-1">
                    {uniqueProcessList.map(procName => (
                      <div key={procName} className="flex items-center">
                        {/* Nombre del Proceso */}
                        <div className="w-28 sm:w-32 flex-shrink-0 font-bold text-white truncate pr-3 text-right text-xs font-sans">
                          {procName}
                        </div>

                        {/* Celdas de la cuadrícula de Gantt */}
                        <div className="flex items-center gap-1">
                          {ganttTicksArray.map(t => {
                            const entry = ganttHistory.find(g => g.tick === t);
                            const state = entry ? entry.states[procName] : undefined;

                            let bgClass = 'bg-slate-900/40 border-slate-700/80';
                            let titleText = `Tick #${t} - ${procName}: Sin actividad`;

                            if (state === 'EJECUCION') {
                              bgClass = 'bg-[#84cc16] border-[#84cc16] shadow-sm';
                              titleText = `Tick #${t} - ${procName}: En ejecución (CPU)`;
                            } else if (state === 'LISTO') {
                              bgClass = 'bg-[#facc15] border-[#facc15] shadow-sm';
                              titleText = `Tick #${t} - ${procName}: En espera (Listo)`;
                            } else if (state === 'BLOQUEADO') {
                              bgClass = 'bg-[#f97316] border-[#f97316] shadow-sm';
                              titleText = `Tick #${t} - ${procName}: En espera de E/S (Bloqueado)`;
                            }

                            return (
                              <div
                                key={t}
                                className={`w-6 h-6 border rounded-sm transition-colors duration-150 flex items-center justify-center ${bgClass}`}
                                title={titleText}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Task Manager (4 Colas con Código de Colores) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {/* 🟦 LISTO (Azul) */}
              <div className="bg-slate-900 border border-blue-900/50 rounded-2xl p-3.5 flex flex-col h-72 shadow-lg">
                <div className="flex items-center justify-between pb-2 border-b border-blue-900/30 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
                    <h3 className="font-bold text-xs text-blue-400">LISTO (Azul)</h3>
                  </div>
                  <span className="text-xs font-mono font-bold bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">
                    {processes.filter(p => p.state === 'LISTO').length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {processes.filter(p => p.state === 'LISTO').map(p => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProcessId(p.id)}
                      className={`p-2.5 rounded-xl border transition cursor-pointer text-xs ${
                        selectedProcessId === p.id
                          ? 'bg-blue-950/60 border-blue-500'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between font-bold text-white mb-1">
                        <span>{p.name}</span>
                        <span className="font-mono text-amber-400">Prio: {p.priority}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                        <span>Ráfaga: <strong className="text-emerald-400">{p.remainingBurst}s</strong></span>
                        <span>{p.pagesCount} Páginas</span>
                      </div>
                    </div>
                  ))}
                  {processes.filter(p => p.state === 'LISTO').length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                      Cola vacía
                    </div>
                  )}
                </div>
              </div>

              {/* 🟩 EJECUCIÓN (Verde) */}
              <div className="bg-slate-900 border border-emerald-900/50 rounded-2xl p-3.5 flex flex-col h-72 shadow-lg">
                <div className="flex items-center justify-between pb-2 border-b border-emerald-900/30 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-ping" />
                    <h3 className="font-bold text-xs text-emerald-400">EJECUCIÓN (Verde)</h3>
                  </div>
                  <span className="text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">
                    {processes.filter(p => p.state === 'EJECUCION').length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {processes.filter(p => p.state === 'EJECUCION').map(p => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProcessId(p.id)}
                      className="p-3 rounded-xl border border-emerald-500/60 bg-emerald-950/40 text-xs space-y-2"
                    >
                      <div className="flex justify-between items-center font-bold text-white">
                        <span>{p.name}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerIO(p.id);
                          }}
                          className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[10px] hover:bg-amber-500/30 flex items-center gap-1"
                        >
                          <Zap className="w-3 h-3" /> Bloquear
                        </button>
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono text-slate-300 mb-1">
                          <span>Ráfaga en vivo:</span>
                          <span className="font-bold text-emerald-400">{p.remainingBurst}s / {p.burst}s</span>
                        </div>
                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                            style={{ width: `${Math.round(((p.burst - p.remainingBurst) / p.burst) * 100)}%` }}
                          />
                        </div>
                      </div>

                      {(algorithm === 'ROUND_ROBIN' || algorithm === 'MULTILEVEL_QUEUE') && (
                        <div className="text-[10px] font-mono text-slate-400 flex justify-between">
                          <span>Quantum:</span>
                          <span>{p.quantumUsed} / {quantum} ticks</span>
                        </div>
                      )}
                    </div>
                  ))}
                  {processes.filter(p => p.state === 'EJECUCION').length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                      CPU Libre (Idle)
                    </div>
                  )}
                </div>
              </div>

              {/* 🟧 BLOQUEADO (Naranja / Amarillo) */}
              <div className="bg-slate-900 border border-amber-900/50 rounded-2xl p-3.5 flex flex-col h-72 shadow-lg">
                <div className="flex items-center justify-between pb-2 border-b border-amber-900/30 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
                    <h3 className="font-bold text-xs text-amber-400">BLOQUEADO (Naranja)</h3>
                  </div>
                  <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
                    {processes.filter(p => p.state === 'BLOQUEADO').length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {processes.filter(p => p.state === 'BLOQUEADO').map(p => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProcessId(p.id)}
                      className="p-2.5 rounded-xl border border-amber-500/40 bg-amber-950/30 text-xs space-y-1"
                    >
                      <div className="font-bold text-white">{p.name}</div>
                      <div className="flex justify-between text-[11px] text-amber-300 font-mono">
                        <span>Esperando E/S:</span>
                        <strong>{p.blockedTicks} ticks</strong>
                      </div>
                    </div>
                  ))}
                  {processes.filter(p => p.state === 'BLOQUEADO').length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                      Sin bloqueos
                    </div>
                  )}
                </div>
              </div>

              {/* ⬛ TERMINADO (Gris) */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col h-72 shadow-lg">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-slate-500" />
                    <h3 className="font-bold text-xs text-slate-400">TERMINADO (Gris)</h3>
                  </div>
                  <span className="text-xs font-mono font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                    {processes.filter(p => p.state === 'TERMINADO').length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {processes.filter(p => p.state === 'TERMINADO').map(p => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 flex items-center justify-between"
                    >
                      <span className="font-bold text-slate-300">{p.name}</span>
                      <span className="text-[10px] font-mono text-slate-500">Ráfaga {p.burst}s ✓</span>
                    </div>
                  ))}
                  {processes.filter(p => p.state === 'TERMINADO').length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-600 text-xs">
                      Sin terminados
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* MMU (Memoria Física RAM y Tabla de Páginas) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Marcos de Memoria Física RAM */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Memoria Física RAM ({totalFramesCount} Marcos)
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                      MMU: {PAGE_REPLACEMENT_INFO[pageReplacement].name.split(' ')[0]}
                    </span>
                    <span className="text-slate-400">
                      {frames.filter(f => f.processId !== null).length}/{frames.length} ocupados
                    </span>
                  </div>
                </div>

                {/* Grid de marcos con indicador de Reloj / Segunda Oportunidad */}
                <div className="grid grid-cols-4 gap-2">
                  {frames.map(frame => {
                    const isClockHandHere = pageReplacement === 'CLOCK' && frame.id === currentClockPointer;
                    return (
                      <div
                        key={frame.id}
                        className={`p-2 rounded-xl border text-center font-mono text-xs flex flex-col justify-between h-24 transition relative ${
                          isClockHandHere
                            ? 'ring-2 ring-amber-400 border-amber-400 bg-slate-900 shadow-md shadow-amber-500/20'
                            : frame.processId !== null
                            ? 'bg-slate-950 border-emerald-500/50 shadow-sm'
                            : 'bg-slate-950/40 border-dashed border-slate-800 text-slate-600'
                        }`}
                      >
                        {/* Indicador de Manecilla de Reloj */}
                        {isClockHandHere && (
                          <span className="absolute -top-2 -right-1 bg-amber-400 text-slate-950 text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-sm">
                            ⏰ Manecilla
                          </span>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 font-bold">Marco #{frame.id}</span>
                          {/* Bit de Referencia R */}
                          {frame.processId !== null && (
                            <span
                              className={`text-[9px] font-bold px-1 py-0.2 rounded ${
                                frame.referenceBit === 1
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                              title="Bit de Referencia R (Uso)"
                            >
                              R={frame.referenceBit}
                            </span>
                          )}
                        </div>

                        {frame.processId !== null ? (
                          <div>
                            <div className="font-bold text-white truncate text-[11px]">
                              {frame.processName}
                            </div>
                            <div className="text-[10px] text-emerald-400 font-bold">
                              Pág #{frame.pageNumber}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-600 font-sans">Libre</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tabla de Páginas del Proceso Activo / Inspeccionado */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      Tabla de Páginas MMU
                    </h3>
                  </div>
                  {inspectedProcess && (
                    <span className="text-xs text-blue-400 font-bold">
                      {inspectedProcess.name}
                    </span>
                  )}
                </div>

                {inspectedProcess ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                        <tr>
                          <th className="p-2">Página Virtual</th>
                          <th className="p-2 text-center">Presencia (RAM)</th>
                          <th className="p-2 text-center">Bit R (Uso)</th>
                          <th className="p-2 text-right">Marco Físico</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-950/50">
                        {inspectedProcess.pageTable.map(pt => (
                          <tr key={pt.pageNumber}>
                            <td className="p-2 font-bold text-white">
                              Página #{pt.pageNumber}
                            </td>
                            <td className="p-2 text-center">
                              {pt.inRAM ? (
                                <span className="text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded text-[10px]">
                                  Válida (En RAM)
                                </span>
                              ) : (
                                <span className="text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded text-[10px]">
                                  Inválida (En Disco)
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-center">
                              {pt.inRAM ? (
                                <span
                                  className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                                    pt.referenceBit === 1
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {pt.referenceBit === 1 ? 'R=1 (2ª Oport.)' : 'R=0 (Candidato)'}
                                </span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            <td className="p-2 text-right font-bold text-emerald-400">
                              {pt.inRAM && pt.frameNumber !== null ? `Marco #${pt.frameNumber}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-8 text-center text-slate-600 text-xs border border-dashed border-slate-800 rounded-xl">
                    Sin proceso activo para mostrar su tabla
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
