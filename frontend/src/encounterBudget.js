// XP budgets per character from SRD 5.2.1 (CC BY 4.0), see supabase/ENCOUNTERS.md.
const budgets = [
  [50,75,100], [100,150,200], [150,225,400], [250,375,500], [500,750,1100],
  [600,1000,1400], [750,1300,1700], [1000,1700,2100], [1300,2000,2600], [1600,2300,3100],
  [1900,2900,4100], [2200,3700,4700], [2600,4200,5400], [2900,4900,6200], [3300,5400,7800],
  [3800,6100,9800], [4500,7200,11700], [5000,8700,14200], [5500,10700,17200], [6400,13200,22000],
];

export function encounterBudget(levels) {
  const totals = [0,0,0];
  for (const level of levels) {
    const allowance = budgets[level - 1];
    if (allowance) allowance.forEach((xp,index) => { totals[index] += xp; });
  }
  return totals;
}
