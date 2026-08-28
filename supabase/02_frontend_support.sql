-- 前端接入支持：补齐 RLS 策略 + 服务端判题函数
-- 在 Supabase SQL Editor 中执行（基础建表脚本已先执行）。

-- 1) 让登录用户能读取专题目录（subjects / topics）
drop policy if exists "read subjects" on public.subjects;
create policy "read subjects"
  on public.subjects for select to authenticated using (true);

drop policy if exists "read topics" on public.topics;
create policy "read topics"
  on public.topics for select to authenticated using (true);

-- 2) 练习记录：用户只能建/看自己的 attempts 与 attempt_answers
drop policy if exists "insert own attempts" on public.attempts;
create policy "insert own attempts"
  on public.attempts for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "read own attempts" on public.attempts;
create policy "read own attempts"
  on public.attempts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "insert own attempt answers" on public.attempt_answers;
create policy "insert own attempt answers"
  on public.attempt_answers for insert to authenticated
  with check (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "read own attempt answers" on public.attempt_answers;
create policy "read own attempt answers"
  on public.attempt_answers for select to authenticated
  using (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = auth.uid()
    )
  );

-- 3) 服务端判题函数
-- 关键点：question_answers 表对前端不可读，但本函数用 SECURITY DEFINER
-- 以提权方式读取正确答案，只把“是否正确”和“正确选项 id（答题后用于展示）”返回，
-- 答案数组本身不会留在浏览器里。未登录（p_user_id 为 null）也能判题，只是不记录。
create or replace function public.judge_answer(
  p_question_id uuid,
  p_selected uuid[],
  p_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correct uuid[];
  v_sel uuid[];
  v_ok boolean;
begin
  select qa.correct_option_ids into v_correct
  from public.question_answers qa
  where qa.question_id = p_question_id;

  if v_correct is null then
    return jsonb_build_object('error', 'question_not_found');
  end if;

  v_sel := coalesce(p_selected, '{}');

  v_ok := (
    array_length(v_sel, 1) = array_length(v_correct, 1)
    and v_sel <@ v_correct
    and v_sel @> v_correct
  );

  if p_user_id is not null and p_attempt_id is not null then
    insert into public.attempt_answers (attempt_id, question_id, selected_option_ids, is_correct)
    values (p_attempt_id, p_question_id, v_sel, v_ok)
    on conflict (attempt_id, question_id) do update
      set selected_option_ids = excluded.selected_option_ids,
          is_correct = excluded.is_correct;
  end if;

  return jsonb_build_object('is_correct', v_ok, 'correct_ids', v_correct);
end;
$$;

grant execute on function public.judge_answer(uuid, uuid[], uuid, uuid) to authenticated;
