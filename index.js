const puppeteer = require("puppeteer");
const sortBy = require("lodash/sortBy");
const storage = require("node-persist");
const { table } = require("table");

const GROUP_ID = process.argv[2] || 185836;

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await storage.init();

  await page.goto(`http://weeklypickem.fantasy.nfl.com/group/${GROUP_ID}`);

  let players = await page.evaluate(() =>
    [...document.querySelectorAll(".groupEntryName a")].map(el => ({
      name: el.innerText.replace("'s picks", ""),
      weeks: [],
      picksUrl: el.href
    }))
  );

  for (player of players) {
    console.log(
      `${player.name}\n${player.name
        .split("")
        .map(() => "=")
        .join("")}`
    );

    let weekNumber = 1;
    let weekHasCompletedGames = true;
    let weekHasIncompleteGames = false;

    while (weekHasCompletedGames && !weekHasIncompleteGames) {
      const cacheKey = `${player.name}-${weekNumber}`;
      const cachedWeek = await storage.getItem(cacheKey);

      let correctCount, incorrectCount;

      if (cachedWeek) {
        correctCount = cachedWeek.correctCount;
        incorrectCount = cachedWeek.incorrectCount;
        weekHasIncompleteGames = false;
      } else {
        await page.goto(`${player.picksUrl}&week=${weekNumber}`);
        correctCount = (await page.$$(".slider-correct")).length;
        incorrectCount = (await page.$$(".slider-incorrect")).length;
        weekHasIncompleteGames = Boolean(
          (await page.$$(".game-state-active")).length +
            (await page.$$(".game-state-pre")).length
        );
      }

      weekHasCompletedGames = Boolean(correctCount + incorrectCount);

      if (weekHasCompletedGames) {
        let points = 0;

        if (weekNumber <= 17) {
          points = correctCount;
        }

        player.weeks.push({
          correctCount,
          overallPoints: 0,
          incorrectCount,
          points
        });

        console.log(`Week ${weekNumber}: ${points}`);
      }

      if (!cachedWeek && !weekHasIncompleteGames) {
        await storage.setItem(cacheKey, { correctCount, incorrectCount });
      }

      weekNumber++;
    }

    console.log("");
  }

  // calculate the current rank for each player at the end of each week
  for (let weekIndex = 0; weekIndex < players[0].weeks.length; weekIndex++) {
    // update overall points up to the current week
    players = players.map(player => {
      player.weeks[weekIndex].overallPoints =
        (player.weeks[weekIndex - 1]
          ? player.weeks[weekIndex - 1].overallPoints
          : 0) + player.weeks[weekIndex].points;
      return player;
    });

    // sort by overall points
    players = sortBy(
      players,
      player => player.weeks[weekIndex].overallPoints
    ).reverse();

    // assign overall rank based on overall points
    players = players.map((player, playerIndex) => {
      player.weeks[weekIndex].overallRank = playerIndex + 1;

      player.weeks[weekIndex].overallRank =
        playerIndex === 0 ||
        player.weeks[weekIndex].overallPoints !==
          players[playerIndex - 1].weeks[weekIndex].overallPoints
          ? playerIndex + 1
          : players[playerIndex - 1].weeks[weekIndex].overallRank;

      return player;
    });

    // sort by weekly points
    players = sortBy(
      players,
      player => player.weeks[weekIndex].points
    ).reverse();

    // assign weekly rank based on weekly points
    players = players.map((player, playerIndex) => {
      player.weeks[weekIndex].weeklyRank =
        playerIndex === 0 ||
        player.weeks[weekIndex].points !==
          players[playerIndex - 1].weeks[weekIndex].points
          ? playerIndex + 1
          : players[playerIndex - 1].weeks[weekIndex].weeklyRank;

      return player;
    });
  }

  // assign overall stats for each player
  players.forEach(player => {
    const currentStats = player.weeks[player.weeks.length - 1];
    const lastWeekStats = player.weeks[player.weeks.length - 2];

    player.overallRank = currentStats.overallRank;
    player.overallRankChange = lastWeekStats
      ? lastWeekStats.overallRank - player.overallRank || ""
      : "";

    if (player.overallRankChange > 0) {
      player.overallRankChange = `+${player.overallRankChange}`;
    }

    player.overallPoints = currentStats.overallPoints;
    player.weeklyPoints = currentStats.points;
    player.weeklyRank = currentStats.weeklyRank;
  });

  // generate table
  players = sortBy(players, "overallRank");

  const tableData = [
    ["Rank", "Change", "Name", "Total Points", "Weekly Points", "Weekly Rank"]
  ].concat(
    players.map(player => [
      player.overallRank,
      player.overallRankChange,
      player.name,
      player.overallPoints,
      player.weeklyPoints,
      player.weeklyRank
    ])
  );

  console.log(table(tableData));

  await browser.close();
})();
