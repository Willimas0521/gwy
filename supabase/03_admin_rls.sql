-- 管理员后台导入：profile 权限 + 注册自动建档 + admin 写题库策略
-- 在 SQL Editor 中执行（需先执行 01 基础建表、02 前端支持）。

-- 1) profiles：用户只读/改自己的资料
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 2) 注册时自动建 profile（默认 student），否则新用户没有 profile 行，admin 判定会失败
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) admin 才能写题库（前端用 anon key，但只有 admin profile 的用户能通过 RLS）
--    question_answers 只给写、不给读，答案数组依旧不进浏览器。
drop policy if exists "admin manage questions" on public.questions;
create policy "admin manage questions"
  on public.questions for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "admin manage options" on public.question_options;
create policy "admin manage options"
  on public.question_options for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "admin insert answers" on public.question_answers;
create policy "admin insert answers"
  on public.question_answers for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "admin update answers" on public.question_answers;
create policy "admin update answers"
  on public.question_answers for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 4) 把你自己设为第一个 admin（把下面邮箱换成你注册用的邮箱后执行）
--    update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = '你的邮箱@example.com');
