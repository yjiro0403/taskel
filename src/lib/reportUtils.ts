
import { Task } from '@/types';

/**
 * Generates a Daily Report in Markdown format.
 * 
 * @param date - The date string (YYYY-MM-DD).
 * @param tasks - List of tasks for the specific date.
 * @param dailyNoteContent - Content of the daily note (markdown).
 * @returns Formatted markdown string.
 */
export const generateDailyReportMarkdown = (
    date: string,
    tasks: Task[],
    dailyNoteContent: string
): string => {
    // 1. Filter Metrics
    const executedTasks = tasks.filter(t => t.status === 'done');
    const unexecutedTasks = tasks.filter(t => t.status !== 'done'); // 'open' or 'in_progress'

    const totalTaskCount = tasks.length;
    const executedCount = executedTasks.length;

    // Calculate total execution time (minutes)
    const totalExecutionTime = executedTasks.reduce((sum, t) => sum + (t.actualMinutes || 0), 0);

    // Calculate achievement rate
    const achievementRate = totalTaskCount > 0
        ? Math.round((executedCount / totalTaskCount) * 100)
        : 0;

    // 2. Build Markdown
    let md = `# Daily Report: ${date}\n\n`;

    // --- Daily Note Section ---
    md += `## 📝 Daily Note\n\n`;
    if (dailyNoteContent.trim()) {
        md += `${dailyNoteContent}\n\n`;
    } else {
        md += `_(No daily note content)_\n\n`;
    }

    // --- Summary Section ---
    md += `## 📊 Summary\n\n`;
    md += `- **Executed Tasks**: ${executedCount} / ${totalTaskCount}\n`;
    md += `- **Achievement Rate**: ${achievementRate}%\n`;
    md += `- **Total Execution Time**: ${totalExecutionTime} min\n\n`;

    // --- Tasks Detail Section ---
    md += `## ✅ Executed Tasks\n\n`;
    if (executedTasks.length > 0) {
        // Sort by completion time or order? Let's use order for now, or completedAt if available.
        // Usually, in a daily report, time order is nice. But `order` is the list order. 
        // Let's stick to the list `order` as it reflects the user's plan.
        const sortedExecuted = [...executedTasks].sort((a, b) => a.order - b.order);

        sortedExecuted.forEach(task => {
            const timeInfo = `${task.actualMinutes}min`;
            md += `- [x] **${task.title}** (${timeInfo})\n`;
            if (task.memo) {
                // Indent memo
                md += `  > ${task.memo.replace(/\n/g, '\n  > ')}\n`;
            }
        });
    } else {
        md += `_(No executed tasks)_\n`;
    }
    md += `\n`;

    // --- Unexecuted Tasks Section ---
    md += `## ⏳ Unexecuted Tasks\n\n`;
    if (unexecutedTasks.length > 0) {
        const sortedUnexecuted = [...unexecutedTasks].sort((a, b) => a.order - b.order);

        sortedUnexecuted.forEach(task => {
            const statusMark = task.status === 'in_progress' ? '[/]' : '[ ]';
            const timeInfo = `${task.estimatedMinutes}min (Est)`;
            md += `- ${statusMark} **${task.title}** (${timeInfo})\n`;
            if (task.memo) {
                md += `  > ${task.memo.replace(/\n/g, '\n  > ')}\n`;
            }
        });
    } else {
        md += `_(All tasks completed)_\n`;
    }

    return md;
};
