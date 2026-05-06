const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadHymns() {
  const bucketName = 'hymns';
  const hymnsDir = path.join(__dirname, '../hymn');
  
  // 1. Check if bucket exists
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    console.error("Error listing buckets:", bucketError);
    process.exit(1);
  }
  
  const bucketExists = buckets.find(b => b.name === bucketName);
  if (!bucketExists) {
    console.log(`Bucket '${bucketName}' does not exist. Creating it...`);
    const { data, error } = await supabase.storage.createBucket(bucketName, {
      public: true
    });
    if (error) {
      console.error("Error creating bucket:", error);
      process.exit(1);
    }
    console.log(`Bucket '${bucketName}' created successfully.`);
  } else {
    console.log(`Bucket '${bucketName}' already exists.`);
  }

  // 2. Read files
  const files = fs.readdirSync(hymnsDir).filter(f => f.toLowerCase().endsWith('.jpg'));
  console.log(`Found ${files.length} images to upload.`);

  // 3. Upload files with concurrency limit
  const concurrency = 10;
  let index = 0;
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  async function worker() {
    while (index < files.length) {
      const fileIndex = index++;
      const fileName = files[fileIndex];
      const filePath = path.join(hymnsDir, fileName);
      const fileBuffer = fs.readFileSync(filePath);
      
      // Check if file already exists
      const { data: existingFiles, error: listError } = await supabase.storage.from(bucketName).list('', {
        search: fileName
      });
      
      if (!listError && existingFiles && existingFiles.find(f => f.name === fileName)) {
        console.log(`[${fileIndex + 1}/${files.length}] Skipping ${fileName} - already exists`);
        skipCount++;
        continue;
      }
      
      const { data, error } = await supabase.storage.from(bucketName).upload(fileName, fileBuffer, {
        contentType: 'image/jpeg',
        upsert: false
      });

      if (error) {
        console.error(`[${fileIndex + 1}/${files.length}] Error uploading ${fileName}:`, error.message);
        errorCount++;
      } else {
        console.log(`[${fileIndex + 1}/${files.length}] Uploaded ${fileName}`);
        successCount++;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  
  console.log('--- Upload Complete ---');
  console.log(`Success: ${successCount}, Skipped: ${skipCount}, Errors: ${errorCount}`);
}

uploadHymns();
