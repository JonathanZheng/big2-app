-- House rules for an online room, chosen by the host when it is created.
-- Null means the standard rules. The server checks every move against them;
-- members read them with the rest of the room to show the table the same way.
alter table public.rooms add column rules jsonb;
