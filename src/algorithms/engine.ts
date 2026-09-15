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
  memoryStatus: 'FAULT' | 'HIT' | null;
  referencedPageName: string | null;
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

  // 1. GESTIÓN DE PROCESOS BLOQUEADOS
  nextProcs.forEach(p => {
    if (p.state === 'BLOQUEADO') {
      if (p.blockedTicks <= 0) {
        p.state = 'LISTO';
        p.blockReason = null;
      } else {
        p.blockedTicks -= 1;
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
        pagesCount: item.pagesCount,
        state: 'INACTIVO',
        arrivalTime: item.arrivalTime,
        quantumUsed: 0,
        blockedTicks: 0,
        pageFaultsCount: 0,
        pageTable: createPageTable(item.pagesCount),
        priority: item.priority,
        lotteryTickets: item.priority
      });
    }
  });

  // 3. ACTIVAR PROCESOS QUE LLEGAN EN ESTE TICK
  nextProcs.forEach(p => {
    if (p.state === 'INACTIVO' && p.arrivalTime <= input.currentTick) {
      p.state = 'LISTO';
    }
  });

  // 4. PLANIFICACIÓN DE CPU
  const readyQueue = nextProcs.filter(p => p.state === 'LISTO' && p.arrivalTime <= input.currentTick);
  const activeProcesses = nextProcs.filter(p => p.state !== 'INACTIVO' && p.state !== 'TERMINADO');
  
  let running = nextProcs.find(p => p.state === 'EJECUCION');

  if (!running && readyQueue.length > 0) {
    const selected = scheduleNextProcess(readyQueue, input.algorithm, activeProcesses, input.currentTick);
    if (selected) {
      const p = nextProcs.find(x => x.id === selected.id);
      if (p) {
        p.state = 'EJECUCION';
        running = p;
      }
    }
  }

  // 5. EJECUCIÓN DEL CICLO DE CPU Y MEMORIA
  let memStatus: 'FAULT' | 'HIT' | null = null;
  let refPageName: string | null = null;
  let executedProcessName: string | null = null;
  let executedProcessId: string | null = null;

  if (running) {
    executedProcessName = running.name;
    executedProcessId = running.id;

    // Calcular qué página referenciará en este tick (ciclo de páginas)
    const ticksAlreadyExecuted = running.burst - running.remainingBurst;
    const pageIndex = ticksAlreadyExecuted % running.pagesCount;
    refPageName = `${running.name}${pageIndex + 1}`; // Sin guion para coincidir con Excel (ej. A1)

    // Acceder a la memoria (Registra Fallo o Acierto)
    const isFault = assignProcessMemory(running, nextFrames, nextProcs, input.currentTick, input.pageReplacement, pageIndex);
    memStatus = isFault ? 'FAULT' : 'HIT';
    if (isFault) {
      running.pageFaultsCount = (running.pageFaultsCount || 0) + 1;
    }

    running.remainingBurst -= 1;
    running.quantumUsed += 1;

    // ¿El proceso completó su ráfaga?
    if (running.remainingBurst <= 0) {
      running.state = 'TERMINADO';
      running.remainingBurst = 0;
      releaseProcessMemory(running, nextFrames);
    } else if (
      (input.algorithm === 'ROUND_ROBIN' || input.algorithm === 'LOTTERY') &&
      running.quantumUsed >= input.quantum
    ) {
      if (input.algorithm === 'ROUND_ROBIN') {
        const otherActive = nextProcs.filter(
          p => p.id !== running!.id && p.state !== 'TERMINADO' && p.remainingBurst > 0
        );
        if (otherActive.length > 0) {
          running.state = 'BLOQUEADO';
          running.blockedTicks = 1; // 1 tick de cambio de contexto
          running.quantumUsed = 0;
          const runIdx = nextProcs.findIndex(p => p.id === running!.id);
          if (runIdx !== -1) {
            const [procItem] = nextProcs.splice(runIdx, 1);
            nextProcs.push(procItem);
          }
        } else {
          running.quantumUsed = 0;
        }
      } else {
        const othersReady = nextProcs.filter(p => p.state === 'LISTO' || p.state === 'EJECUCION');
        if (othersReady.length > 1) { 
          running.state = 'LISTO';
          running.quantumUsed = 0;
        } else {
          running.quantumUsed = 0;
        }
      }
    } else if (
      input.algorithm === 'MULTILEVEL_QUEUE' &&
      running.quantumUsed >= input.quantum
    ) {
      if (running.priority >= 7) {
        running.quantumUsed = 0;
      } else {
        const othersReady = nextProcs.filter(p => p.state === 'LISTO');
        if (othersReady.length > 0) {
          running.state = 'LISTO';
          running.quantumUsed = 0;
        } else {
          running.quantumUsed = 0;
        }
      }
    }
  }

  return {
    nextTick,
    processes: nextProcs,
    frames: nextFrames,
    executedProcessName,
    executedProcessId,
    memoryStatus: memStatus,
    referencedPageName: refPageName
  };
}
