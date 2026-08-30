export type ProcessState = 'LISTO' | 'EJECUCION' | 'BLOQUEADO' | 'TERMINADO';

export type SchedulerAlgorithm =
  | 'ROUND_ROBIN'
  | 'SJF'
  | 'PRIORITY'
  | 'FIFO'
  | 'LOTTERY'
  | 'GUARANTEED'
  | 'MULTILEVEL_QUEUE';

export type PageReplacementAlgorithm = 'FIFO' | 'LRU';

export interface PageEntry {
  pageNumber: number;
  frameNumber: number | null; // null si no está en RAM
  inRAM: boolean;
  lastAccessTick?: number;    // Para LRU
  allocatedAtTick?: number;   // Para FIFO
}

export interface ProcessItem {
  id: string;
  name: string;
  color: string;
  burst: number;          // Ráfaga total de CPU
  remainingBurst: number; // Ráfaga restante
  priority: number;       // 1 (Alta) a 10 (Baja)
  pagesCount: number;     // Cantidad de páginas requeridas
  state: ProcessState;
  arrivalTime: number;    // Instante t de llegada
  quantumUsed: number;
  blockedTicks: number;   // Ticks restantes en bloqueo I/O
  pageTable: PageEntry[];
  lotteryTickets?: number; // Para planificación por sorteo
}

export interface Frame {
  id: number;
  processId: string | null;
  processName: string | null;
  color: string | null;
  pageNumber: number | null;
  allocatedAtTick: number; // Para FIFO
  lastAccessTick: number;  // Para LRU
}

export interface ScheduledTask {
  id: string;
  name: string;
  burst: number;
  pagesCount: number;
  arrivalTime: number;
  priority: number;
  color: string;
}

export interface OSConfig {
  algorithm: SchedulerAlgorithm;
  pageReplacement: PageReplacementAlgorithm;
  quantum: number;
  totalRAMKB: number;
  pageSizeKB: number;
  totalFrames: number;
  clockSpeedMs: number;
}
