import type { ProcessItem, Frame, SchedulerAlgorithm, PageReplacementAlgorithm, ScheduledTask } from '../types/os';
import { scheduleNextProcess } from './scheduler';
import { assignProcessMemory, releaseProcessMemory, createPageTable, checkProcessPageFault } from './mmu';

export interface TickInput {
  currentTick: number;
  processes: ProcessItem[];
  frames: Frame[];
  scheduledTasks: ScheduledTask[];
  algorithm: SchedulerAlgorithm;
  pageReplacement: PageReplacementAlgorithm;
  quantum: number;
}

export interface TickOutput {
  nextTick: number;
  processes: ProcessItem[];
  frames: Frame[];
  executedProcessName: string | null;
  executedProcessId: string | null;
}

/**
 * ============================================================================
 * MOTOR DEL RELOJ DEL SISTEMA OPERATIVO (GAME LOOP DETERMINISTA)
 * ============================================================================
 */
export function executeClockTick(input: TickInput): TickOutput {
  const nextTick = input.currentTick + 1;

  // Clonar estados para inmutabilidad reactiva
  const nextProcs: ProcessItem[] = input.processes.map(p => ({
    ...p,
    pageTable: p.pageTable.map(pt => ({ ...pt })),
  }));
  const nextFrames: Frame[] = input.frames.map(f => ({ ...f }));

  // 1. GESTIÓN DE PROCESOS BLOQUEADOS (I/O manual o Fallo de Página)
  nextProcs.forEach(p => {
    if (p.state === 'BLOQUEADO' && p.blockedTicks > 0) {
      p.blockedTicks -= 1;
      if (p.blockedTicks <= 0) {
        p.state = 'LISTO';
        p.blockedTicks = 0;
        p.blockReason = null;
      }
    }
  });

  // 2. INCORPORAR NUEVAS TAREAS SI NO ESTABAN PRESENTES
  input.scheduledTasks.forEach(item => {
    if (!nextProcs.some(p => p.id === item.id || p.name === item.name)) {
      nextProcs.push({
        id: item.id,
        name: item.name,
        color: item.color,
        burst: item.burst,
        remainingBurst: item.burst,
        priority: item.priority,
        pagesCount: item.pagesCount,
        state: 'LISTO',
        arrivalTime: item.arrivalTime,
        quantumUsed: 0,
        blockedTicks: 0,
        blockReason: null,
        pageFaultsCount: 0,
        pageTable: createPageTable(item.pagesCount),
      });
    }
  });

  // 3. PLANIFICADOR DE CPU (Si el procesador está libre)
  let running = nextProcs.find(p => p.state === 'EJECUCION');

  // Si el proceso actualmente en ejecución perdió páginas en RAM por reemplazo de otro proceso
  if (
    input.algorithm !== 'SJF' &&
    input.algorithm !== 'ROUND_ROBIN' &&
    running &&
    checkProcessPageFault(running)
  ) {
    assignProcessMemory(running, nextFrames, nextProcs, nextTick, input.pageReplacement);
    running.state = 'BLOQUEADO';
    running.blockedTicks = 2; // Latencia de intercambio de disco (Page Fault)
    running.blockReason = 'PAGE_FAULT';
    running.pageFaultsCount = (running.pageFaultsCount || 0) + 1;
    running = undefined;
  }

  if (!running) {
    if (input.algorithm === 'ROUND_ROBIN') {
      // En Round Robin: buscar el primer proceso que no haya terminado con llegada <= tick actual
      let candidate = nextProcs.find(
        p => p.state !== 'TERMINADO' && p.remainingBurst > 0 && p.arrivalTime <= input.currentTick
      );
      // Fallback si aún no llega ninguno pero existen en cola
      if (!candidate) {
        candidate = nextProcs.find(p => p.state !== 'TERMINADO' && p.remainingBurst > 0);
      }

      if (candidate) {
        candidate.state = 'EJECUCION';
        running = candidate;
        assignProcessMemory(running, nextFrames, nextProcs, nextTick, input.pageReplacement);
      }
    } else {
      const readyQueue = nextProcs.filter(
        p => p.state === 'LISTO' && p.arrivalTime <= input.currentTick
      );
      const fallbackQueue =
        readyQueue.length > 0 ? readyQueue : nextProcs.filter(p => p.state === 'LISTO');
      const activeProcesses = nextProcs.filter(
        p => p.state === 'LISTO' || p.state === 'EJECUCION'
      );
      const selected = scheduleNextProcess(
        fallbackQueue,
        input.algorithm,
        activeProcesses,
        nextTick
      );

      if (selected) {
        if (input.algorithm !== 'SJF' && checkProcessPageFault(selected)) {
          // Fallo de Página detectado: cargar páginas en RAM y bloquear por tiempo de E/S de disco
          assignProcessMemory(selected, nextFrames, nextProcs, nextTick, input.pageReplacement);
          selected.state = 'BLOQUEADO';
          selected.blockedTicks = 2; // Latencia de 2 ticks simulando lectura desde disco
          selected.blockReason = 'PAGE_FAULT';
          selected.pageFaultsCount = (selected.pageFaultsCount || 0) + 1;
          running = undefined;
        } else {
          selected.state = 'EJECUCION';
          running = selected;
          assignProcessMemory(running, nextFrames, nextProcs, nextTick, input.pageReplacement);
        }
      }
    }
  }

  let executedProcessName: string | null = null;
  let executedProcessId: string | null = null;

  // 4. EJECUCIÓN DEL CICLO EN CPU
  if (running) {
    executedProcessName = running.name;
    executedProcessId = running.id;

    running.remainingBurst -= 1;
    running.quantumUsed += 1;

    // Asegurar y actualizar referencias de sus páginas en RAM
    assignProcessMemory(running, nextFrames, nextProcs, nextTick, input.pageReplacement);

    // ¿El proceso completó su ráfaga?
    if (running.remainingBurst <= 0) {
      running.state = 'TERMINADO';
      running.remainingBurst = 0;
      // MMU: Liberar marcos de RAM
      releaseProcessMemory(running, nextFrames);
    } else if (
      input.algorithm === 'ROUND_ROBIN' &&
      running.quantumUsed >= input.quantum
    ) {
      // Expiración de Quantum en Round Robin:
      // Pasar a BLOQUEADO (Naranja) y rotar al final de la cola para que el siguiente tome la CPU
      const otherActive = nextProcs.filter(
        p => p.id !== running!.id && p.state !== 'TERMINADO' && p.remainingBurst > 0
      );
      if (otherActive.length > 0) {
        running.state = 'BLOQUEADO';
        running.quantumUsed = 0;
        // Rotar al final de la lista para mantener orden circular
        const runIdx = nextProcs.findIndex(p => p.id === running!.id);
        if (runIdx !== -1) {
          const [procItem] = nextProcs.splice(runIdx, 1);
          nextProcs.push(procItem);
        }
      } else {
        running.quantumUsed = 0;
      }
    } else if (
      input.algorithm === 'MULTILEVEL_QUEUE' &&
      running.quantumUsed >= input.quantum
    ) {
      // Expiración de Quantum en Multicola
      const othersReady = nextProcs.filter(p => p.state === 'LISTO');
      if (othersReady.length > 0) {
        running.state = 'LISTO';
        running.quantumUsed = 0;
      } else {
        running.quantumUsed = 0;
      }
    }
  }

  return {
    nextTick,
    processes: nextProcs,
    frames: nextFrames,
    executedProcessName,
    executedProcessId,
  };
}
