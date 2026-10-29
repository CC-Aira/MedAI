import MeadowStage from "@/components/MeadowStage";
import { requireUser } from "@/lib/auth";
import { listPatients } from "@/lib/patients";
import { listTodayBoard } from "@/lib/medication-board";
import { DISEASES } from "@/data/diseases";
import { DRUGS } from "@/data/drugs";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  // 只取当前账号自己的档案 —— listPatients 的 where 里写死了 ownerId
  const patients = await listPatients(user.id);
  // 草地上那块小木牌：只有设了用药跟踪的档案才会上榜，一个都没有就是一块空板子
  const board = await listTodayBoard(user.id);

  return (
    <MeadowStage
      initialPatients={patients}
      email={user.email}
      counts={{ diseases: DISEASES.length, drugs: DRUGS.length }}
      board={board}
    />
  );
}
