const SIGNIN_URL = "https://learn.reboot01.com/api/auth/signin";
const GRAPHQL_URL = "https://learn.reboot01.com/api/graphql-engine/v1/graphql";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const TOKEN_KEY = "reboot_jwt";


// SQL
const USER_QUERY = `{
  user {
    id
    login
    attrs
    auditRatio
    totalUp
    totalDown
  }
}`;

const USER_DATA_QUERY = `query Data($userId: Int!) {
  transaction(
    where: {
      type: { _eq: "xp" },
      path: { _regex: "^/bahrain/bh-module/([^/]+|checkpoint/[^/]+)$" }
    },
    order_by: { createdAt: asc }
  ) {
    amount
    createdAt
    path
    objectId
    object {
      name
      type
    }
  }

  progress(
    where: { userId: { _eq: $userId } }
    order_by: { createdAt: desc }
  ) {
    id
    grade
    createdAt
    path
    object {
      name
      type
    }
  }

  result(
    where: { userId: { _eq: $userId } }
    order_by: { createdAt: desc }
    limit: 15
  ) {
    id
    grade
    createdAt
    path
    user {
      id
      login
    }
  }
}`;

const everythingQuery = `query Everything($userId: Int!) {
  user(where: { id: { _eq: $userId } }) {
    id
    login
    attrs
    auditRatio
    totalUp
    totalDown
    createdAt
    updatedAt
  }

  transaction(
    where: { userId: { _eq: $userId } }
    order_by: { id: asc }
  ) {
    id
    amount
    type
    path
    createdAt
    objectId
    recipientId
    eventId
    object {
      id
      name
      type
      attrs
    }
  }

  progress(
    where: { userId: { _eq: $userId } }
    order_by: { id: asc }
  ) {
    id
    grade
    createdAt
    path
    objectId
    object {
      id
      name
      type
      attrs
    }
  }
  result(
    where: { userId: { _eq: $userId } }
    order_by: { id: asc }
  ) {
    id
    grade
    createdAt
    path
    objectId
    userId
    object {
      id
      name
      type
    }
    user {
      id
      login
    }
  }

  event_user(
    where: { userId: { _eq: $userId } }
    order_by: { id: asc }
  ) {
    id
    userId
    eventId
    createdAt
    event {
      id
      name
      path
      startAt
      endAt
    }
  }
}`;

function parseJwt(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    console.error("Invalid JWT", error);
    return null;
  }
}

function get(element) {
    return document.getElementById(element);
}

function showProfile() {
    get("auth").style.display = "none";
    get("profile").style.visibility = "visible";
}

function hideProfile() {
    get("profile").style.visibility = "hidden";
    get("auth").style.display = "";
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  hideProfile();
}

hideProfile()

async function signIn(identifier, password) {
  const credentials = btoa(`${identifier}:${password}`);
  const response = await fetch(SIGNIN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`
    }
  });

  const res = await response.text();

  if (!response.ok) {
    let message = "Invalid login.";

    try {
      const data = JSON.parse(res);
      if (data.error) message = data.error;
    } catch (exception) {}

    throw new Error(message);
  }

  const token = res.replace(/^"|"$/g, "").trim();

  if (!token || token.split(".").length !== 3) {
    throw new Error("Unexpected response from the server.");
  }

  return token;
}

async function graphqlRequest(query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (response.status === 401) {
    logout();
    throw new Error("Session expired.");
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(result.errors[0].message);
  }

  return result.data;
}

async function loadProfile() {
  const userIdFromToken = Number(parseJwt(localStorage.getItem(TOKEN_KEY)));

  const userResponse = await graphqlRequest(USER_QUERY);
  const currentUser = userResponse.user[0];

  const userId = currentUser.id ?? userIdFromToken;
  const userDetails = await graphqlRequest(USER_DATA_QUERY, { userId });
  console.log(userDetails)

  get("i-login").textContent = currentUser.login;
  get("i-id").textContent = currentUser.id;
  get("i-name").textContent = [currentUser.attrs?.firstName, currentUser.attrs?.lastName].filter(Boolean).join(" ") || "—";
  get("i-email").textContent = currentUser.attrs?.email || "—";
  get("i-campus").textContent = currentUser.attrs?.campus || "Reboot01";

  const xpTransactions = userDetails.transaction;
  const totalXp = xpTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);

  get("i-xp").textContent = formatXp(totalXp);
  get("i-xp-sub").textContent = `${xpTransactions.length} transactions`;

  let cumulativeXp = 0;
  const xpPoints = xpTransactions.map((transaction) => {
    cumulativeXp += transaction.amount;
    return {
      time: new Date(transaction.createdAt).getTime(),
      cumulativeXp,
      deltaXp: transaction.amount,
      projectName: transaction.object?.name || getLastPathSegment(transaction.path)
    };
  });

  lineChart(get("chart-xp"), xpPoints);

  const projectXpMap = {};

  console.log(projectXpMap);

  xpTransactions.forEach((transaction) => {
    // Only count if the object exists and its type is "project"
    if (transaction.object?.type === "project") {
      const projectName = transaction.object.name || getLastPathSegment(transaction.path);
      projectXpMap[projectName] = (projectXpMap[projectName] || 0) + transaction.amount;
    }
  });

  const topProjects = Object.entries(projectXpMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));

  barChart(get("chart-projects"), topProjects);

  const gradedProgress = userDetails.progress.filter(
    (progress) => progress.grade !== null && progress.object?.type === "project"
    );
    const passed = gradedProgress.filter((progress) => progress.grade >= 1).length;
    const failed = gradedProgress.length - passed;

  get("i-pass").textContent = passed;
  get("i-fail").textContent = failed;

  donutChart(get("chart-ratio"), [
    { label: "PASS", value: passed, color: "#4ade80" },
    { label: "FAIL", value: failed, color: "#f87171" }
  ]);

  const auditsDone = currentUser.totalUp || 0;
  const auditsReceived = currentUser.totalDown || 0;
  const auditRatio = currentUser.auditRatio ?? (auditsReceived ? auditsDone / auditsReceived : 0);

  get("i-ratio").textContent = auditRatio.toFixed(2);
  get("i-done").textContent = formatXp(auditsDone);
  get("i-received").textContent = formatXp(auditsReceived);

  donutChart(get("chart-audit"), [
    { label: "Done", value: auditsDone, color: "#38bdf8", display: formatXp(auditsDone) },
    { label: "Received", value: auditsReceived, color: "#a78bfa", display: formatXp(auditsReceived) }
  ]);

  const recentResultsList = get("recent");
  recentResultsList.replaceChildren();

  userDetails.progress.slice(0, 100).forEach((result) => {
    const listItem = document.createElement("li");

    const projectName = document.createElement("span");
    projectName.textContent = getLastPathSegment(result.path);

    const resultTag = document.createElement("span");
    const passedResult = result.grade >= 1;
    resultTag.className = `tag ${passedResult ? "pass" : "fail"}`;
    resultTag.textContent = `${passedResult ? "PASS" : "FAIL"} · ${formatDate(result.createdAt)}`;

    listItem.appendChild(projectName);
    listItem.appendChild(resultTag);
    recentResultsList.appendChild(listItem);
  });
}

get("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const errorMessage = get("login-error");
  const loginButton = get("login-btn");

  errorMessage.hidden = true;
  loginButton.disabled = true;

  try {
    const identifier = get("identifier").value.trim();
    const password = get("password").value;

    const token = await signIn(identifier, password);
    
    localStorage.setItem(TOKEN_KEY, token);

    showProfile();
    await loadProfile();
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    hideProfile();
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Sign in";
  }
});


// ---- Formatting helpers ----
function formatXp(value) {
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + " MB";
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(1) + " kB";
  }
  return value + " B";
}

function getLastPathSegment(path) {
  return (path || "").split("/").filter(Boolean).pop() || "—";
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

// ---- SVG helpers ----
function createSvgElement(tagName, attributes = {}, textContent) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }

  if (textContent !== undefined) {
    element.textContent = textContent;
  }

  return element;
}

function createSvgRoot(width, height) {
  return createSvgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img"
  });
}

function polarToCartesian(centerX, centerY, radius, angle) {
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle)
  };
}

// ---- Charts ----
function lineChart(container, dataPoints) {
  container.replaceChildren();

  const width = 620;
  const height = 260;
  const padding = { left: 52, right: 14, top: 14, bottom: 30 };
  const svg = createSvgRoot(width, height);

  if (dataPoints.length === 0) {
    container.appendChild(svg);
    return;
  }

  const times = dataPoints.map((point) => point.time);
  const cumulativeValues = dataPoints.map((point) => point.cumulativeXp);

  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxCumulative = Math.max(...cumulativeValues);

  const xScale = (time) => {
    const range = maxTime - minTime || 1;
    return padding.left + ((time - minTime) / range) * (width - padding.left - padding.right);
  };

  const yScale = (value) => {
    return height - padding.bottom - (value / (maxCumulative || 1)) * (height - padding.top - padding.bottom);
  };

  // Horizontal grid lines and labels
  for (let i = 0; i <= 4; i++) {
    const gridValue = (maxCumulative / 4) * i;
    const y = yScale(gridValue);

    const gridLine = createSvgElement("line", {
      x1: padding.left,
      x2: width - padding.right,
      y1: y,
      y2: y,
      class: "gline"
    });
    svg.appendChild(gridLine);

    const label = createSvgElement(
      "text",
      { x: 6, y: y + 4, class: "glabel" },
      formatXp(Math.round(gridValue))
    );
    svg.appendChild(label);
  }

  // Build line and area path strings
  const linePathData = dataPoints
    .map((point, index) => {
      const x = xScale(point.time).toFixed(1);
      const y = yScale(point.cumulativeXp).toFixed(1);
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  const areaPathData = `${linePathData} L${xScale(maxTime).toFixed(1)},${height - padding.bottom} L${xScale(minTime).toFixed(1)},${height - padding.bottom} Z`;

  // Gradient for area fill
  const gradient = createSvgElement("linearGradient", {
    id: "xpgrad",
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  });

  const stop1 = createSvgElement("stop", {
    offset: "0%",
    "stop-color": "#4ade80",
    "stop-opacity": "0.45"
  });
  const stop2 = createSvgElement("stop", {
    offset: "100%",
    "stop-color": "#4ade80",
    "stop-opacity": "0"
  });

  gradient.appendChild(stop1);
  gradient.appendChild(stop2);

  const defs = createSvgElement("defs");
  defs.appendChild(gradient);
  svg.appendChild(defs);

  const areaPath = createSvgElement("path", {
    d: areaPathData,
    fill: "url(#xpgrad)"
  });
  svg.appendChild(areaPath);

  const linePath = createSvgElement("path", {
    d: linePathData,
    fill: "none",
    stroke: "#4ade80",
    "stroke-width": 2.5,
    "stroke-linejoin": "round"
  });
  svg.appendChild(linePath);

  // Add circles with tooltips at a reasonable sample rate
  const step = Math.ceil(dataPoints.length / 40) || 1;

  dataPoints.forEach((point, index) => {
    if (index % step !== 0) return;

    const circle = createSvgElement("circle", {
      cx: xScale(point.time),
      cy: yScale(point.cumulativeXp),
      r: 3,
      fill: "#0d1117",
      stroke: "#4ade80",
      "stroke-width": 2
    });

    const tooltip = createSvgElement(
      "title",
      {},
      `${formatDate(point.time)} — ${formatXp(point.cumulativeXp)} total (+${formatXp(point.deltaXp)} ${point.projectName})`
    );

    circle.appendChild(tooltip);
    svg.appendChild(circle);
  });

  // X-axis date labels
  const startLabel = createSvgElement(
    "text",
    { x: padding.left, y: height - 8, class: "glabel" },
    formatDate(minTime)
  );
  svg.appendChild(startLabel);

  const endLabel = createSvgElement(
    "text",
    { x: width - padding.right - 60, y: height - 8, class: "glabel" },
    formatDate(maxTime)
  );
  svg.appendChild(endLabel);

  // Animate line drawing
  const pathLength = linePath.getTotalLength();
  linePath.setAttribute("stroke-dasharray", pathLength);
  linePath.setAttribute("stroke-dashoffset", pathLength);

  const animation = createSvgElement("animate", {
    attributeName: "stroke-dashoffset",
    from: pathLength,
    to: 0,
    dur: "1.2s",
    fill: "freeze"
  });
  linePath.appendChild(animation);

  container.appendChild(svg);
}

function barChart(container, items) {
  container.replaceChildren();

  const width = 620;
  const rowHeight = 26;
  const padding = { left: 150, right: 60, top: 8, bottom: 8 };
  const height = padding.top + padding.bottom + items.length * rowHeight;
  const svg = createSvgRoot(width, height);

  const maxValue = Math.max(...items.map((item) => item.value), 1);

  items.forEach((item, index) => {
    const y = padding.top + index * rowHeight;
    const barWidth = ((width - padding.left - padding.right) * item.value) / maxValue;

    const label = createSvgElement(
      "text",
      {
        x: padding.left - 10,
        y: y + 15,
        class: "glabel",
        "text-anchor": "end"
      },
      item.label.slice(0, 22)
    );
    svg.appendChild(label);

    const bar = createSvgElement("rect", {
      x: padding.left,
      y: y + 4,
      width: 0,
      height: rowHeight - 10,
      rx: 5,
      class: "bar"
    });

    const tooltip = createSvgElement("title", {}, `${item.label}: ${formatXp(item.value)}`);
    bar.appendChild(tooltip);

    const animation = createSvgElement("animate", {
      attributeName: "width",
      from: 0,
      to: barWidth,
      dur: "0.8s",
      fill: "freeze"
    });
    bar.appendChild(animation);

    svg.appendChild(bar);

    const valueLabel = createSvgElement(
      "text",
      { x: padding.left + barWidth + 8, y: y + 15, class: "glabel" },
      formatXp(item.value)
    );
    svg.appendChild(valueLabel);
  });

  container.appendChild(svg);
}

function donutChart(container, parts) {
  container.replaceChildren();

  const width = 260;
  const height = 220;
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = 78;
  const innerRadius = 50;
  const svg = createSvgRoot(width, height);

  const visibleParts = parts.filter((part) => part.value > 0);
  const total = visibleParts.reduce((sum, part) => sum + part.value, 0);

  if (total === 0) {
    const message = createSvgElement(
      "text",
      { x: centerX, y: centerY, class: "glabel", "text-anchor": "middle" },
      "No data"
    );
    svg.appendChild(message);
    container.appendChild(svg);
    return;
  }

  // Special case: a single slice covering 100% — a single SVG arc command
  // can't draw a full circle because start/end points coincide, so split
  // it into two half-circle arcs instead.
  if (visibleParts.length === 1) {
    const part = visibleParts[0];
    const midAngle = -Math.PI / 2 + Math.PI; // halfway point
    const startAngle = -Math.PI / 2;

    const outerTop = polarToCartesian(centerX, centerY, outerRadius, startAngle);
    const outerMid = polarToCartesian(centerX, centerY, outerRadius, midAngle);
    const innerTop = polarToCartesian(centerX, centerY, innerRadius, startAngle);
    const innerMid = polarToCartesian(centerX, centerY, innerRadius, midAngle);

    const pathData = [
      `M${outerTop.x},${outerTop.y}`,
      `A${outerRadius},${outerRadius} 0 1 1 ${outerMid.x},${outerMid.y}`,
      `A${outerRadius},${outerRadius} 0 1 1 ${outerTop.x},${outerTop.y}`,
      `L${innerTop.x},${innerTop.y}`,
      `A${innerRadius},${innerRadius} 0 1 0 ${innerMid.x},${innerMid.y}`,
      `A${innerRadius},${innerRadius} 0 1 0 ${innerTop.x},${innerTop.y}`,
      "Z"
    ].join(" ");

    const path = createSvgElement("path", {
      d: pathData,
      fill: part.color,
      opacity: "0.9"
    });

    const title = createSvgElement("title", {}, `${part.label}: ${part.display || formatXp(part.value)} (100%)`);
    path.appendChild(title);
    svg.appendChild(path);

    const centerText = createSvgElement(
      "text",
      {
        x: centerX,
        y: centerY + 5,
        class: "glabel",
        "text-anchor": "middle",
        style: "font-size:16px;fill:#e6edf3"
      },
      `100% ${part.label}`
    );
    svg.appendChild(centerText);

    container.appendChild(svg);
    return;
  }

  let startAngle = -Math.PI / 2;

  visibleParts.forEach((part) => {
    const angle = (part.value / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    const largeArcFlag = angle > Math.PI ? 1 : 0;

    const outerStart = polarToCartesian(centerX, centerY, outerRadius, startAngle);
    const outerEnd = polarToCartesian(centerX, centerY, outerRadius, endAngle);
    const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
    const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);

    const pathData = [
      `M${outerStart.x},${outerStart.y}`,
      `A${outerRadius},${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x},${outerEnd.y}`,
      `L${innerEnd.x},${innerEnd.y}`,
      `A${innerRadius},${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x},${innerStart.y}`,
      "Z"
    ].join(" ");

    const path = createSvgElement("path", {
      d: pathData,
      fill: part.color,
      opacity: "0.9"
    });

    const percentage = Math.round((part.value / total) * 100);
    const title = createSvgElement(
      "title",
      {},
      `${part.label}: ${part.display || formatXp(part.value)} (${percentage}%)`
    );

    path.appendChild(title);
    svg.appendChild(path);

    startAngle = endAngle;
  });

  const mainPart = visibleParts[0];
  const mainPercentage = Math.round((mainPart.value / total) * 100);

  const centerText = createSvgElement(
    "text",
    {
      x: centerX,
      y: centerY + 5,
      class: "glabel",
      "text-anchor": "middle",
      style: "font-size:16px;fill:#e6edf3"
    },
    `${mainPercentage}% ${mainPart.label}`
  );
  svg.appendChild(centerText);

  container.appendChild(svg);
}