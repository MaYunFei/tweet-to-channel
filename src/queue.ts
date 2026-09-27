export type Task<T = any> = () => Promise<T>

export class TaskQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  /**
   * Push a task to the FIFO queue.
   * Returns a promise that resolves when this specific task completes.
   */
  push<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task()
          resolve(result)
        } catch (err) {
          reject(err)
        }
      })
      this.processNext()
    })
  }

  private async processNext(): Promise<void> {
    if (this.running || this.queue.length === 0) return
    this.running = true
    const nextTask = this.queue.shift()
    if (nextTask) {
      try {
        await nextTask()
      } catch (err) {
        console.error('[Queue] Error executing task:', err)
      } finally {
        this.running = false
        this.processNext()
      }
    }
  }

  /**
   * Total number of tasks waiting in queue plus currently executing task.
   */
  get size(): number {
    return this.queue.length + (this.running ? 1 : 0)
  }

  get isRunning(): boolean {
    return this.running
  }
}

export const taskQueue = new TaskQueue()
