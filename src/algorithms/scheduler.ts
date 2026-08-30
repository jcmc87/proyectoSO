import type { ProcessItem, SchedulerAlgorithm } from '../types/os';

/**
 * ============================================================================
 * ALGORITMOS DE PLANIFICACIÓN DE CPU COMPLETOS (CPU SCHEDULING)
 * ============================================================================
 */

/**
 * 1. Proceso Más Corto (Shortest Job First / SJF)
 * Selecciona el proceso de la cola con el menor tiempo de ráfaga restante.
 * En caso de empate, elige el que llegó primero (menor arrivalTime).
 */
export function selectSJF(readyQueue: ProcessItem[]): ProcessItem | null {
  if (readyQueue.length === 0) return null;
  return readyQueue.reduce((shortest, current) => {
    if (current.remainingBurst < shortest.remainingBurst) {
      return current;
    } else if (current.remainingBurst === shortest.remainingBurst) {
      return current.arrivalTime < shortest.arrivalTime ? current : shortest;
    }
    return shortest;
  });
}

/**
 * 2. Por Prioridad (Priority Scheduling)
 * Selecciona el proceso con mayor prioridad (menor número = mayor prioridad, ej. 1 es máxima).
 * En caso de empate, elige por orden de llegada (arrivalTime).
 */
export function selectPriority(readyQueue: ProcessItem[]): ProcessItem | null {
  if (readyQueue.length === 0) return null;
  return readyQueue.reduce((highest, current) => {
    if (current.priority < highest.priority) {
      return current;
    } else if (current.priority === highest.priority) {
      return current.arrivalTime < highest.arrivalTime ? current : highest;
    }
    return highest;
  });
}

/**
 * 3. Round Robin (RR)
 * Selecciona el primer proceso de la cola de listos en orden circular para su quantum.
 */
export function selectRoundRobin(readyQueue: ProcessItem[]): ProcessItem | null {
  if (readyQueue.length === 0) return null;
  return readyQueue[0];
}

/**
 * 4. First-In, First-Out (FIFO / FCFS)
 * Selecciona estrictamente el primer proceso en llegar.
 */
export function selectFIFO(readyQueue: ProcessItem[]): ProcessItem | null {
  if (readyQueue.length === 0) return null;
  return readyQueue[0];
}

/**
 * 5. Planificación por Sorteo / Lotería (Lottery Scheduling)
 * Cada proceso recibe boletos de lotería según su prioridad (mayor prioridad = más boletos).
 * Se sortea un boleto aleatorio ponderado y el proceso ganador obtiene el turno en CPU.
 */
export function selectLottery(readyQueue: ProcessItem[]): ProcessItem | null {
  if (readyQueue.length === 0) return null;
  if (readyQueue.length === 1) return readyQueue[0];

  // Asignar boletos: Prioridad 1 -> 10 boletos, Prioridad 10 -> 1 boleto
  const ticketRanges: { process: ProcessItem; start: number; end: number }[] = [];
  let totalTickets = 0;

  readyQueue.forEach(proc => {
    // Cálculo de boletos ponderados: al menos 1 boleto
    const tickets = Math.max(1, 11 - proc.priority);
    proc.lotteryTickets = tickets;
    ticketRanges.push({
      process: proc,
      start: totalTickets,
      end: totalTickets + tickets - 1,
    });
    totalTickets += tickets;
  });

  // Generar número ganador del sorteo
  const winningTicket = Math.floor(Math.random() * totalTickets);

  // Encontrar el proceso ganador
  const winner = ticketRanges.find(
    r => winningTicket >= r.start && winningTicket <= r.end
  );

  return winner ? winner.process : readyQueue[0];
}

/**
 * 6. Planificación Garantizada (Guaranteed Scheduling / 1/n)
 * Si hay n procesos en el sistema, a cada uno se le promete 1/n del tiempo de CPU.
 * Se calcula la razón = (Tiempo de CPU consumido) / (Tiempo prometido).
 * Se selecciona el proceso con la menor razón (el más atrasado / desfavorecido).
 */
export function selectGuaranteed(
  readyQueue: ProcessItem[],
  allActiveProcesses: ProcessItem[],
  currentTick: number
): ProcessItem | null {
  if (readyQueue.length === 0) return null;
  if (readyQueue.length === 1) return readyQueue[0];

  const n = Math.max(1, allActiveProcesses.length);

  return readyQueue.reduce((mostStarved, current) => {
    // Tiempo que el proceso ha estado en el sistema
    const timeInSystemCurrent = Math.max(1, currentTick - current.arrivalTime);
    const promisedCPUCurrent = timeInSystemCurrent / n;
    const cpuUsedCurrent = Math.max(0.1, current.burst - current.remainingBurst);
    const ratioCurrent = cpuUsedCurrent / promisedCPUCurrent;

    const timeInSystemStarved = Math.max(1, currentTick - mostStarved.arrivalTime);
    const promisedCPUStarved = timeInSystemStarved / n;
    const cpuUsedStarved = Math.max(0.1, mostStarved.burst - mostStarved.remainingBurst);
    const ratioStarved = cpuUsedStarved / promisedCPUStarved;

    return ratioCurrent < ratioStarved ? current : mostStarved;
  });
}

/**
 * 7. Multicola (Multilevel Queue - MLQ)
 * Clasifica los procesos en colas según nivel de prioridad:
 * - Cola 1 (Prioridad Alta 1-3): Planificada con Round Robin / Rápida
 * - Cola 2 (Prioridad Media 4-6): Planificada con Round Robin
 * - Cola 3 (Prioridad Baja / Batch 7-10): Planificada con FIFO
 */
export function selectMultilevelQueue(readyQueue: ProcessItem[]): ProcessItem | null {
  if (readyQueue.length === 0) return null;

  // Cola 1: Prioridad 1 a 3 (Alta)
  const highPriorityQueue = readyQueue.filter(p => p.priority <= 3);
  if (highPriorityQueue.length > 0) {
    return highPriorityQueue[0];
  }

  // Cola 2: Prioridad 4 a 6 (Media)
  const mediumPriorityQueue = readyQueue.filter(p => p.priority >= 4 && p.priority <= 6);
  if (mediumPriorityQueue.length > 0) {
    return mediumPriorityQueue[0];
  }

  // Cola 3: Prioridad 7 a 10 (Baja / Batch)
  const lowPriorityQueue = readyQueue.filter(p => p.priority >= 7);
  if (lowPriorityQueue.length > 0) {
    return lowPriorityQueue[0];
  }

  return readyQueue[0];
}

/**
 * Despachador principal que ejecuta el algoritmo seleccionado
 */
export function scheduleNextProcess(
  readyQueue: ProcessItem[],
  algorithm: SchedulerAlgorithm,
  allActiveProcesses: ProcessItem[] = [],
  currentTick: number = 0
): ProcessItem | null {
  switch (algorithm) {
    case 'SJF':
      return selectSJF(readyQueue);
    case 'PRIORITY':
      return selectPriority(readyQueue);
    case 'LOTTERY':
      return selectLottery(readyQueue);
    case 'GUARANTEED':
      return selectGuaranteed(readyQueue, allActiveProcesses, currentTick);
    case 'MULTILEVEL_QUEUE':
      return selectMultilevelQueue(readyQueue);
    case 'ROUND_ROBIN':
      return selectRoundRobin(readyQueue);
    case 'FIFO':
      return selectFIFO(readyQueue);
    default:
      return selectFIFO(readyQueue);
  }
}
