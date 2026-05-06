const fs = require("fs");
const path = require("path");

const filesToProcess = [
  "components/SearchPanel.tsx",
  "components/VerseDisplay.tsx",
  "app/page.tsx",
  "components/CardBuilder.tsx",
  "components/WorshipBible.tsx",
  "components/GlobalFontSettings.tsx",
  "components/ScrapList.tsx"
];

const replacements = [
  [/bg-white/g, "bg-white dark:bg-gray-800"],
  [/bg-gray-50/g, "bg-gray-50 dark:bg-gray-900"],
  [/bg-gray-100/g, "bg-gray-100 dark:bg-gray-800"],
  [/bg-gray-200/g, "bg-gray-200 dark:bg-gray-700"],
  
  [/text-gray-900/g, "text-gray-900 dark:text-gray-100"],
  [/text-gray-800/g, "text-gray-800 dark:text-gray-200"],
  [/text-gray-700/g, "text-gray-700 dark:text-gray-300"],
  [/text-gray-600/g, "text-gray-600 dark:text-gray-400"],
  [/text-gray-500/g, "text-gray-500 dark:text-gray-400"],
  
  [/border-gray-100/g, "border-gray-100 dark:border-gray-800"],
  [/border-gray-200/g, "border-gray-200 dark:border-gray-700"],
  [/border-gray-300/g, "border-gray-300 dark:border-gray-600"],
  
  [/shadow-sm/g, "shadow-sm dark:shadow-none"],
  [/shadow-md/g, "shadow-md dark:shadow-none"],
  [/shadow-lg/g, "shadow-lg dark:shadow-none"]
];

function processFile(filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, "utf-8");
  
  // Prevent double replacements (e.g., if "dark:bg-gray-800" is already there)
  // To keep it simple, we just replace, then fix double dark classes.
  for (const [regex, replacement] of replacements) {
    content = content.replace(regex, replacement);
  }
  
  // Cleanup duplicates that might have been created
  content = content.replace(/dark:bg-gray-800 dark:bg-gray-[0-9]+/g, "dark:bg-gray-800");
  content = content.replace(/dark:bg-gray-900 dark:bg-gray-[0-9]+/g, "dark:bg-gray-900");
  content = content.replace(/dark:text-gray-[0-9]+ dark:text-gray-[0-9]+/g, function(match) {
     return match.split(" ")[0]; // Keep the first one
  });
  content = content.replace(/dark:border-gray-[0-9]+ dark:border-gray-[0-9]+/g, function(match) {
     return match.split(" ")[0]; 
  });
  content = content.replace(/dark:shadow-none dark:shadow-none/g, "dark:shadow-none");

  fs.writeFileSync(fullPath, content, "utf-8");
  console.log("Processed " + filePath);
}

filesToProcess.forEach(processFile);
