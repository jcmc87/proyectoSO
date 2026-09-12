import type { ProcessItem, Frame, SchedulerAlgorithm, PageReplacementAlgorithm, ScheduledTask } from '../types/os';
import { scheduleNextProcess } from './scheduler';
import { assignProcessMemory, releaseProcessMemory, createPageTable } from './mmu';

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

  // 1. GESTIÓN DE PROCESOS BLOQUEADOS (I/O)
  nextProcs.forEach(p => {
    if (p.state === 'BLOQUEADO') {
      p.blockedTicks -= 1;
      if (p.blockedTicks <= 0) {
        p.state = 'LISTO';
        p.blockedTicks = 0;
      }
    }
  });

  // 2. LLEGADAS DETERMINISTAS (Arribos en t = currentTick)
  const arrivals = input.scheduledTasks.filter(item => item.arrivalTime === input.currentTick);
  arrivals.forEach((item, idx) => {
    nextProcs.push({
      id: `${item.id}-${nextTick}-${idx}`,
      name: item.name,
      color: item.color,
      burst: item.burst,
      remainingBurst: item.burst,
      priority: item.priority,
      pagesCount: item.pagesCount,
      state: 'LISTO',
      arrivalTime: nextTick,
      quantumUsed: 0,
      blockedTicks: 0,
      pageTable: createPageTable(item.pagesCount),
    });
  });

  // 3. PLANIFICADOR DE CPU (Si el procesador está libre)
  let running = nextProcs.find(p => p.state === 'EJECUCION');

  if (!running) {
    const readyQueue = nextProcs.filter(p => p.state === 'LISTO');
    const activeProcesses = nextProcs.filter(p => p.state === 'LISTO' || p.state === 'EJECUCION');
    const selected = scheduleNextProcess(readyQueue, input.algorithm, activeProcesses, nextTick);

    if (selected) {
      selected.state = 'EJECUCION';
      running = selected;
      // MMU: Asignar marcos en RAM al proceso elegido
      assignProcessMemory(running, nextFrames, nextProcs, nextTick, input.pageReplacement);
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

    // Asegurar que sus páginas estén en RAM
    assignProcessMemory(running, nextFrames, nextProcs, nextTick, input.pageReplacement);

    // ¿El proceso completó su ráfaga?
    if (running.remainingBurst <= 0) {
      running.state = 'TERMINADO';
      running.remainingBurst = 0;
      // MMU: Liberar marcos de RAM
      releaseProcessMemory(running, nextFrames);
    } else if (
      (input.algorithm === 'ROUND_ROBIN' || input.algorithm === 'MULTILEVEL_QUEUE') &&
      running.quantumUsed >= input.quantum
    ) {
      // Expiración de Quantum en Round Robin o Multicola
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
