import type { PostgrestError } from '@supabase/supabase-js';
import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import { timeUpdate, toTimeOrNull } from '@/lib/supabase/normalize';
import type { Database } from '@/types/supabase';
import { Section } from '@/types';
import { StoreState, SectionSlice, SectionReferenceCounts } from '../types';

// セクションの表示順は authSlice の realtime 反映と同じ規則（開始時刻 → order）に揃える。
// 楽観的更新でローカルへ差し込む際も同じ並びを維持しないと、保存直後だけ順序が乱れる。
function sortSections(sections: Section[]) {
    return [...sections].sort(
        (a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.order - b.order
    );
}

// delete_section_with_reassign（マイグレーション 20260712*_delete_section_with_reassign.sql）は
// 未適用の環境があり得る。型生成前提の Database['public']['Functions'] にはまだ載っていないため、
// ここだけ最小限の型を当てて呼び出す。マイグレーション適用後に supabase の型を再生成し、
// この定義は削除して client.rpc の型推論に寄せること。
type DeleteSectionRpcArgs = {
    target_section_id: string;
    reassign_to_section_id: string | null;
};
type DeleteSectionRpcClient = {
    rpc: (
        fn: 'delete_section_with_reassign',
        args: DeleteSectionRpcArgs
    ) => Promise<{ error: PostgrestError | null }>;
};

// RPC が DB 側に存在しない（＝マイグレーション未適用）ことを示すエラーか判定する。
// PostgREST はスキーマキャッシュに無い関数を PGRST202 で返し、Postgres 側は 42883。
function isMissingFunctionError(error: PostgrestError) {
    if (error.code === 'PGRST202' || error.code === '42883') return true;
    const message = `${error.message ?? ''}`.toLowerCase();
    return message.includes('could not find the function') || message.includes('does not exist');
}

export const createSectionSlice: StateCreator<StoreState, [], [], SectionSlice> = (set, get) => ({
    sections: [],

    addSection: async (section) => {
        const { user } = get();
        if (!user) return;

        const newSection: Section = { ...section, userId: user.uid };

        // 楽観的更新（失敗時は追加した id のみ取り除く）
        set((state) => ({
            sections: sortSections([
                ...state.sections.filter((item) => item.id !== newSection.id),
                newSection,
            ]),
        }));

        // sections.start_time / end_time は Postgres の time 列。空文字は受け付けないため必ず null 化する
        // （time 入力をクリアすると '' が来る）。
        const payload: Database['public']['Tables']['sections']['Insert'] = {
            id: newSection.id,
            user_id: user.uid,
            name: newSection.name,
            start_time: toTimeOrNull(newSection.startTime),
            end_time: toTimeOrNull(newSection.endTime),
            order: newSection.order,
        };

        const { error } = await createClient().from('sections').insert(payload);
        if (error) {
            console.error('Error adding section:', error);
            set((state) => ({
                sections: state.sections.filter((item) => item.id !== newSection.id),
            }));
            // 呼び出し側（設定画面）が失敗を検知してエラー表示できるよう必ず throw する。
            throw error;
        }
    },

    updateSection: async (sectionId, updates) => {
        const previous = get().sections.find((item) => item.id === sectionId);

        // 楽観的更新（失敗時は対象 id のみ操作前の値へ戻す）
        set((state) => ({
            sections: sortSections(
                state.sections.map((item) => (item.id === sectionId ? { ...item, ...updates } : item))
            ),
        }));

        // time 列は undefined（＝更新しない）と ''（＝クリア→null）を区別して正規化する。
        const payload: Database['public']['Tables']['sections']['Update'] = {
            name: updates.name,
            start_time: timeUpdate(updates.startTime),
            end_time: timeUpdate(updates.endTime),
            order: updates.order,
        };

        const rollback = () => {
            if (!previous) return;
            set((state) => ({
                sections: sortSections(
                    state.sections.map((item) => (item.id === sectionId ? previous : item))
                ),
            }));
        };

        // PostgREST の UPDATE は RLS や削除済み ID で対象が0件でも error=null を返す。
        // 更新行を返させ、0件を「保存成功」と誤認しない（呼び出し側は成功トーストを出すため）。
        const { data: updated, error } = await createClient()
            .from('sections')
            .update(payload)
            .eq('id', sectionId)
            .select('id')
            .maybeSingle();
        if (error) {
            console.error('Error updating section:', error);
            rollback();
            throw error;
        }
        if (!updated) {
            rollback();
            throw new Error('セクションを更新できませんでした（対象が見つからないか、権限がありません）。');
        }
    },

    // 削除対象セクションを参照している行数を数える（UI の警告・移動先選択に使う）。
    countSectionReferences: async (sectionId) => {
        const { user } = get();
        const empty: SectionReferenceCounts = { tasks: 0, routines: 0 };
        if (!user) return empty;

        const client = createClient();
        const [taskResult, routineResult] = await Promise.all([
            client
                .from('tasks')
                .select('id', { head: true, count: 'exact' })
                .eq('section_id', sectionId)
                .eq('user_id', user.uid),
            client
                .from('routines')
                .select('id', { head: true, count: 'exact' })
                .eq('section_id', sectionId)
                .eq('user_id', user.uid),
        ]);

        if (taskResult.error) {
            console.error('Error counting section tasks:', taskResult.error);
            throw taskResult.error;
        }
        if (routineResult.error) {
            console.error('Error counting section routines:', routineResult.error);
            throw routineResult.error;
        }

        return {
            tasks: taskResult.count ?? 0,
            routines: routineResult.count ?? 0,
        };
    },

    // セクション削除。
    // sections への FK は tasks/routines ともに `on delete restrict`（001_initial_schema.sql）
    // のままなので、参照行が1件でもあると DELETE は必ず失敗する。よって「参照行の付け替え →
    // セクション削除」を行う必要がある。
    //  - tasks.section_id: 006 で nullable 化済み → 移動先なしなら NULL（＝バックログ扱い）にできる。
    //  - routines.section_id: 008 で nullable 化済みだが、アプリ型 Routine.sectionId は必須 string で
    //    セクション無しルーチンは仮想タスクの配置先を失う。よって NULL 化はせず、移動先未指定なら
    //    データを壊さずエラーにする。
    //
    // 正しい経路は DB 関数 delete_section_with_reassign（1トランザクション）。
    // マイグレーション未適用の環境でもアプリが動き続けるよう、関数が存在しない場合のみ
    // クライアント側の逐次実行にフォールバックする（この経路は原子的ではない）。
    deleteSection: async (sectionId, reassignToSectionId) => {
        const { user } = get();
        const removed = get().sections.find((item) => item.id === sectionId);

        if (!user) {
            set((state) => ({ sections: state.sections.filter((item) => item.id !== sectionId) }));
            return;
        }

        if (reassignToSectionId === sectionId) {
            throw new Error('移動先に削除対象と同じセクションは指定できません。');
        }

        const references = await get().countSectionReferences(sectionId);
        if (references.routines > 0 && !reassignToSectionId) {
            throw new Error(
                `このセクションには${references.routines}件のルーチンが紐づいています。移動先のセクションを指定してください。`
            );
        }

        const client = createClient();
        const nextSectionId = reassignToSectionId ?? '';

        // 楽観的更新（巻き戻しは「この操作で触れた id のみ」に限定し、書き込み中に届いた
        // 無関係な realtime 更新を巻き込まないようにする）。
        const affectedTaskIds = new Set(
            get().tasks.filter((task) => task.sectionId === sectionId).map((task) => task.id)
        );
        const affectedRoutineIds = new Set(
            get().routines.filter((routine) => routine.sectionId === sectionId).map((routine) => routine.id)
        );

        set((state) => ({
            sections: state.sections.filter((item) => item.id !== sectionId),
            tasks: state.tasks.map((task) =>
                affectedTaskIds.has(task.id) ? { ...task, sectionId: nextSectionId } : task
            ),
            routines: state.routines.map((routine) =>
                affectedRoutineIds.has(routine.id) ? { ...routine, sectionId: nextSectionId } : routine
            ),
        }));

        const restoreSection = () => {
            set((state) => ({
                sections: removed && !state.sections.some((item) => item.id === removed.id)
                    ? sortSections([...state.sections, removed])
                    : state.sections,
            }));
        };

        // 参照行の巻き戻しは「DB 上で実際に付け替わっていないもの」だけに限定する。
        // 付け替え済みの行を巻き戻すと画面が嘘をつくうえ、直後に届く realtime UPDATE と衝突する。
        const restoreReferences = (options: { tasks: boolean; routines: boolean }) => {
            set((state) => ({
                tasks: options.tasks
                    ? state.tasks.map((task) =>
                        affectedTaskIds.has(task.id) ? { ...task, sectionId } : task
                    )
                    : state.tasks,
                routines: options.routines
                    ? state.routines.map((routine) =>
                        affectedRoutineIds.has(routine.id) ? { ...routine, sectionId } : routine
                    )
                    : state.routines,
            }));
        };

        // ---- 経路1: DB 関数（付け替え + 削除を1トランザクションで実行） ----
        const rpcClient = client as unknown as DeleteSectionRpcClient;
        let rpcError: PostgrestError | null = null;
        try {
            const result = await rpcClient.rpc('delete_section_with_reassign', {
                target_section_id: sectionId,
                reassign_to_section_id: reassignToSectionId ?? null,
            });
            rpcError = result.error;
            if (!rpcError) {
                return;
            }
        } catch (error) {
            // 通信エラー等。DB 側はトランザクションなので、コミットされていなければ何も変わっていない。
            console.error('Error deleting section (rpc):', error);
            restoreSection();
            restoreReferences({ tasks: true, routines: true });
            throw error;
        }

        if (!isMissingFunctionError(rpcError)) {
            // 関数は存在するが失敗した（権限・FK 等）。トランザクションはロールバック済み。
            console.error('Error deleting section (rpc):', rpcError);
            restoreSection();
            restoreReferences({ tasks: true, routines: true });
            throw new Error(rpcError.message || 'セクションの削除に失敗しました。');
        }

        // ---- 経路2: フォールバック（マイグレーション未適用） ----
        // 3リクエストに分かれるため原子的ではない。付け替えが成功した後に DELETE が失敗した場合、
        // DB 上のタスク/ルーチンは本当に移動済みなので、その分はローカルも巻き戻さず、
        // メッセージでも「移動は済んだが削除に失敗した」と正直に伝える。
        // 再実行時は参照行が0件になっているため、付け替えを飛ばして DELETE だけが走る（冪等）。
        let tasksReassigned = false;
        let routinesReassigned = false;

        try {
            if (references.tasks > 0) {
                const { data, error } = await client
                    .from('tasks')
                    .update({ section_id: reassignToSectionId ?? null })
                    .eq('section_id', sectionId)
                    .eq('user_id', user.uid)
                    .select('id');
                if (error) throw error;
                // RLS で弾かれた UPDATE は error=null / 0件で返る。0件を成功と誤認しない。
                if (!data || data.length === 0) {
                    throw new Error('タスクの移動に失敗しました（対象のタスクを更新できませんでした）。');
                }
                tasksReassigned = true;
            }

            if (references.routines > 0 && reassignToSectionId) {
                const { data, error } = await client
                    .from('routines')
                    .update({ section_id: reassignToSectionId })
                    .eq('section_id', sectionId)
                    .eq('user_id', user.uid)
                    .select('id');
                if (error) throw error;
                if (!data || data.length === 0) {
                    throw new Error('ルーチンの移動に失敗しました（対象のルーチンを更新できませんでした）。');
                }
                routinesReassigned = true;
            }

            const { data: deleted, error } = await client
                .from('sections')
                .delete()
                .eq('id', sectionId)
                .eq('user_id', user.uid)
                .select('id');
            if (error) throw error;
            // DELETE も 0件マッチで error=null。削除できていないのに成功扱いにしない。
            if (!deleted || deleted.length === 0) {
                throw new Error('セクションを削除できませんでした（対象が見つからないか、権限がありません）。');
            }
        } catch (error) {
            console.error('Error deleting section:', error);
            restoreSection();
            restoreReferences({ tasks: !tasksReassigned, routines: !routinesReassigned });

            if (tasksReassigned || routinesReassigned) {
                throw new Error(
                    'タスクは移動しましたが、セクションの削除に失敗しました。もう一度お試しください。'
                );
            }
            throw error;
        }
    },

    rebuildSections: async () => {
        const { user } = get();
        if (!user) return;

        const standards = [
            { name: 'Morning', startTime: '06:00', endTime: '09:00' },
            { name: 'Work', startTime: '09:00', endTime: '12:00' },
            { name: 'Afternoon', startTime: '13:00', endTime: '18:00' },
            { name: 'Night', startTime: '19:00', endTime: '22:00' },
        ];

        const convertToMinutes = (timeStr: string) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };

        const formatTime = (totalMinutes: number) => {
            const h = Math.floor(totalMinutes / 60);
            const m = totalMinutes % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        const newSections: Section[] = [];
        let currentMinutes = 0;

        standards.sort((a, b) => convertToMinutes(a.startTime) - convertToMinutes(b.startTime));

        for (const standard of standards) {
            const startMins = convertToMinutes(standard.startTime);
            const endMins = convertToMinutes(standard.endTime);

            if (currentMinutes < startMins) {
                const startStr = formatTime(currentMinutes);
                newSections.push({
                    id: crypto.randomUUID(),
                    userId: user.uid,
                    name: 'Interval',
                    startTime: startStr,
                    endTime: standard.startTime,
                    order: newSections.length,
                });
            }

            newSections.push({
                id: crypto.randomUUID(),
                userId: user.uid,
                name: standard.name,
                startTime: standard.startTime,
                endTime: standard.endTime,
                order: newSections.length,
            });
            currentMinutes = endMins;
        }

        if (currentMinutes < 24 * 60) {
            const startStr = formatTime(currentMinutes);
            newSections.push({
                id: crypto.randomUUID(),
                userId: user.uid,
                name: 'Interval',
                startTime: startStr,
                endTime: '24:00',
                order: newSections.length,
            });
        }

        const client = createClient();
        const { error: deleteError } = await client.from('sections').delete().eq('user_id', user.uid);
        if (deleteError) {
            console.error('Error rebuilding sections:', deleteError);
            return;
        }

        const { error: insertError } = await client.from('sections').insert(
            newSections.map((section) => ({
                id: section.id,
                user_id: user.uid,
                name: section.name,
                // time 列。ここは常に 'HH:mm' だが、addSection/updateSection と正規化を揃えておく。
                start_time: toTimeOrNull(section.startTime),
                end_time: toTimeOrNull(section.endTime),
                order: section.order,
            }))
        );

        if (insertError) {
            console.error('Error rebuilding sections:', insertError);
        }
    },

    resetSectionSlice: () => set({ sections: [] }),
});
