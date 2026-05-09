/**
 * Demo seed — 50 providers + 20 users
 * Run: bun scripts/seed-demo.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

// ── Auth DB ──────────────────────────────────────────────────
const AUTH_URL = process.env.AUTH_DATABASE_URL || 'postgresql://hompushparajmehta@localhost:5432/longeny_auth';
const CORE_URL = process.env.CORE_DATABASE_URL  || 'postgresql://hompushparajmehta@localhost:5432/longeny_core';

const authSql  = postgres(AUTH_URL,  { max: 5 });
const coreSql  = postgres(CORE_URL,  { max: 5 });

// Inline schema imports
import { credentials, roles, user_roles } from '../apps/auth-service/src/db/schema.js';
import {
  users, user_profiles, health_profiles,
  providers,
} from '../apps/user-provider-service/src/db/schema.js';

const authDb = drizzle(authSql, { schema: { credentials, roles, user_roles } });
const coreDb = drizzle(coreSql, { schema: { users, user_profiles, health_profiles, providers } });

// ── Helper ───────────────────────────────────────────────────
async function hashPassword(pw: string) {
  return Bun.password.hash(pw, { algorithm: 'bcrypt', cost: 10 });
}

// ── Provider data ────────────────────────────────────────────
const PROVIDERS = [
  // ── Weight Loss / Fitness ──
  { name: 'Aarav Sharma',    business: 'FitLife Coaching',        bio: 'Certified weight loss and nutrition coach with 8 years of experience helping clients transform their lives.', specialties: ['Weight Loss','Nutrition','HIIT Training'], city: 'Mumbai', rate: 1500, exp: 8,  virtual: true,  inPerson: true,  rating: 4.8, gender: 'male' },
  { name: 'Priya Patel',     business: 'SlimFit Studio',          bio: 'I specialize in sustainable weight loss programs combining diet, exercise, and mindset coaching.', specialties: ['Weight Loss','Cardio & Endurance','Stress Management'], city: 'Pune', rate: 1200, exp: 5,  virtual: true,  inPerson: false, rating: 4.5, gender: 'female' },
  { name: 'Rohan Mehta',     business: 'Rohan Fitness Hub',       bio: 'Bodybuilding champion turned personal trainer. I help men and women build functional, lean muscle.', specialties: ['Muscle Building','Strength Training','Sports Nutrition'], city: 'Delhi', rate: 2000, exp: 12, virtual: false, inPerson: true,  rating: 4.9, gender: 'male' },
  { name: 'Sunita Rao',      business: 'WellnessFirst',           bio: 'Holistic wellness coach focusing on weight management, stress reduction, and healthy lifestyle habits.', specialties: ['Weight Loss','Stress Management','Sleep Optimization'], city: 'Bangalore', rate: 1800, exp: 7, virtual: true, inPerson: true, rating: 4.6, gender: 'female' },
  { name: 'Vikram Singh',    business: 'Alpha Fitness',           bio: 'Elite personal trainer specializing in high-intensity interval training and functional fitness.', specialties: ['HIIT Training','Muscle Building','Sports Performance'], city: 'Hyderabad', rate: 2500, exp: 10, virtual: true, inPerson: true, rating: 4.7, gender: 'male' },

  // ── Nutrition / Dietetics ──
  { name: 'Meera Krishnan',  business: 'NutriWise',               bio: 'Registered dietitian with expertise in clinical nutrition, sports nutrition, and plant-based diets.', specialties: ['Sports Nutrition','Plant-Based Diet','Weight Loss'], city: 'Chennai', rate: 1600, exp: 9,  virtual: true,  inPerson: false, rating: 4.8, gender: 'female' },
  { name: 'Arjun Gupta',     business: 'FoodScience Coaching',    bio: 'Sports nutritionist working with athletes and weekend warriors to optimize performance through diet.', specialties: ['Sports Nutrition','Muscle Building','Cardio & Endurance'], city: 'Delhi', rate: 1400, exp: 6,  virtual: true,  inPerson: true,  rating: 4.4, gender: 'male' },
  { name: 'Deepa Nair',      business: 'PlantPower Nutrition',    bio: 'Passionate about plant-based nutrition. I help clients transition to vegan/vegetarian diets without losing nutrients.', specialties: ['Plant-Based Diet','Weight Loss','Stress Management'], city: 'Kochi', rate: 1100, exp: 4,  virtual: true,  inPerson: false, rating: 4.3, gender: 'female' },
  { name: 'Sanjay Verma',    business: 'MetaBoost Nutrition',     bio: 'Clinical dietitian specializing in metabolic disorders, diabetes management, and weight loss.', specialties: ['Weight Loss','Sports Nutrition','Sleep Optimization'], city: 'Jaipur', rate: 1300, exp: 7,  virtual: true,  inPerson: true,  rating: 4.6, gender: 'male' },
  { name: 'Kavita Desai',    business: 'HealThrough Food',        bio: 'Ayurvedic nutritionist blending traditional wisdom with modern dietary science for holistic healing.', specialties: ['Plant-Based Diet','Stress Management','Weight Loss'], city: 'Ahmedabad', rate: 900, exp: 11, virtual: true, inPerson: true, rating: 4.5, gender: 'female' },

  // ── Mental Health / Stress ──
  { name: 'Dr. Ananya Roy',  business: 'MindBalance Wellness',    bio: 'Licensed psychologist with 15 years in cognitive behavioral therapy, anxiety, and stress management.', specialties: ['Stress Management','Sleep Optimization','Mental Health'], city: 'Kolkata', rate: 3000, exp: 15, virtual: true, inPerson: true, rating: 4.9, gender: 'female' },
  { name: 'Karan Malhotra',  business: 'CalmMind Coaching',       bio: 'Life and mental wellness coach helping professionals manage burnout, anxiety, and work-life balance.', specialties: ['Stress Management','Sleep Optimization','Mindfulness'], city: 'Gurgaon', rate: 2200, exp: 8,  virtual: true,  inPerson: false, rating: 4.7, gender: 'male' },
  { name: 'Ritu Sharma',     business: 'Inner Harmony Wellness',  bio: 'Certified mindfulness coach and therapist. I combine meditation, breathwork, and CBT techniques.', specialties: ['Stress Management','Mental Health','Mindfulness'], city: 'Mumbai', rate: 1800, exp: 6,  virtual: true,  inPerson: true,  rating: 4.5, gender: 'female' },
  { name: 'Aditya Kumar',    business: 'ThinkWell Coaching',      bio: 'Executive coach and mental performance specialist helping leaders and athletes achieve peak mental fitness.', specialties: ['Mental Health','Stress Management','Sports Performance'], city: 'Bangalore', rate: 4000, exp: 13, virtual: true, inPerson: false, rating: 4.8, gender: 'male' },
  { name: 'Pooja Iyer',      business: 'Serenity Now',            bio: 'Trauma-informed wellness coach focusing on stress, grief recovery, and emotional resilience.', specialties: ['Mental Health','Stress Management','Sleep Optimization'], city: 'Hyderabad', rate: 1500, exp: 5,  virtual: true,  inPerson: true,  rating: 4.4, gender: 'female' },

  // ── Yoga / Meditation ──
  { name: 'Lakshmi Menon',   business: 'YogaGuru Studio',         bio: 'RYT-500 certified yoga instructor with 20 years teaching Hatha, Ashtanga, and therapeutic yoga.', specialties: ['Flexibility & Mobility','Stress Management','Mindfulness'], city: 'Rishikesh', rate: 800, exp: 20, virtual: true, inPerson: true, rating: 4.9, gender: 'female' },
  { name: 'Rohit Joshi',     business: 'Pranayama Pro',           bio: 'Yoga and pranayama teacher specializing in breathwork for stress relief, lung health, and athletic recovery.', specialties: ['Flexibility & Mobility','Mindfulness','Cardio & Endurance'], city: 'Pune', rate: 700, exp: 9,  virtual: true,  inPerson: true,  rating: 4.6, gender: 'male' },
  { name: 'Anita Bhatt',     business: 'FlowState Yoga',          bio: 'Vinyasa and yin yoga teacher. I help busy professionals build strength, flexibility, and mental calm.', specialties: ['Flexibility & Mobility','Stress Management','Weight Loss'], city: 'Ahmedabad', rate: 600, exp: 7,  virtual: true,  inPerson: false, rating: 4.4, gender: 'female' },
  { name: 'Devraj Pillai',   business: 'Ashtanga Academy',        bio: 'Traditional Ashtanga yoga practitioner and teacher. 18 years of practice and 12 years of teaching.', specialties: ['Flexibility & Mobility','Muscle Building','Mindfulness'], city: 'Mysore', rate: 1000, exp: 12, virtual: false, inPerson: true, rating: 4.8, gender: 'male' },
  { name: 'Shruti Kulkarni', business: 'Mindful Moves',           bio: 'Yoga therapist using yoga, meditation, and sound healing for chronic pain, anxiety, and insomnia.', specialties: ['Flexibility & Mobility','Stress Management','Sleep Optimization'], city: 'Nagpur', rate: 900, exp: 8,  virtual: true,  inPerson: true,  rating: 4.5, gender: 'female' },

  // ── Sports Performance / Athletic ──
  { name: 'Manish Tiwari',   business: 'Peak Performance Lab',    bio: 'Ex-national athlete turned sports performance coach. I train cricketers, footballers, and track athletes.', specialties: ['Sports Performance','HIIT Training','Cardio & Endurance'], city: 'Delhi', rate: 3000, exp: 14, virtual: false, inPerson: true, rating: 4.9, gender: 'male' },
  { name: 'Sneha Patil',     business: 'Athletic Edge',           bio: 'Strength and conditioning coach with experience training professional athletes and competitive amateurs.', specialties: ['Sports Performance','Muscle Building','Sports Nutrition'], city: 'Mumbai', rate: 2800, exp: 11, virtual: true, inPerson: true, rating: 4.7, gender: 'female' },
  { name: 'Rajesh Nambiar',  business: 'EndurancePro',            bio: 'Marathon runner and triathlete coach. Specializing in endurance sports, running form, and race preparation.', specialties: ['Cardio & Endurance','Marathon Training','Sports Nutrition'], city: 'Bangalore', rate: 2000, exp: 9,  virtual: true,  inPerson: false, rating: 4.6, gender: 'male' },
  { name: 'Preethi Suresh',  business: 'Sprint & Strength',       bio: 'Track and field coach specializing in speed, agility, and power training for competitive athletes.', specialties: ['Sports Performance','HIIT Training','Muscle Building'], city: 'Chennai', rate: 2500, exp: 10, virtual: false, inPerson: true, rating: 4.8, gender: 'female' },
  { name: 'Nikhil Bose',     business: 'FuncFit Training',        bio: 'Functional fitness coach training clients for real-world strength, mobility, and injury prevention.', specialties: ['Sports Performance','Flexibility & Mobility','HIIT Training'], city: 'Kolkata', rate: 1700, exp: 7,  virtual: true,  inPerson: true,  rating: 4.5, gender: 'male' },

  // ── Rehabilitation / Physical Therapy ──
  { name: 'Dr. Rahul Chandra', business: 'PhysioPlus Rehab',       bio: 'Physiotherapist with specialized training in sports injury rehabilitation, post-surgery recovery, and chronic pain.', specialties: ['Rehabilitation','Flexibility & Mobility','Sports Performance'], city: 'Pune', rate: 2500, exp: 12, virtual: false, inPerson: true, rating: 4.9, gender: 'male' },
  { name: 'Kavitha Subramanian', business: 'HealMotion Physio',    bio: 'Senior physiotherapist specializing in orthopedic and neurological rehabilitation.', specialties: ['Rehabilitation','Flexibility & Mobility','Stress Management'], city: 'Coimbatore', rate: 2000, exp: 10, virtual: true, inPerson: true, rating: 4.7, gender: 'female' },
  { name: 'Amol Jadhav',     business: 'BackToStrength',           bio: 'Expert in back pain, sciatica, and spinal rehabilitation. Combines physio with corrective exercise.', specialties: ['Rehabilitation','Flexibility & Mobility','Muscle Building'], city: 'Nashik', rate: 1800, exp: 8,  virtual: true,  inPerson: true,  rating: 4.6, gender: 'male' },
  { name: 'Nalini Krishnamurthy', business: 'ActiveRecovery Clinic', bio: 'Sports physiotherapist working with post-operative patients and athletes returning from injury.', specialties: ['Rehabilitation','Sports Performance','Flexibility & Mobility'], city: 'Hyderabad', rate: 2200, exp: 9, virtual: false, inPerson: true, rating: 4.8, gender: 'female' },
  { name: 'Suresh Pillai',   business: 'MobilityFirst',            bio: 'Orthopedic physiotherapist helping clients recover from joint replacements, fractures, and chronic arthritis.', specialties: ['Rehabilitation','Flexibility & Mobility','Stress Management'], city: 'Kochi', rate: 1600, exp: 15, virtual: true, inPerson: true, rating: 4.7, gender: 'male' },

  // ── Marathon / Endurance ──
  { name: 'Arun Nayak',      business: 'RunFar Coaching',          bio: 'IAAF-certified running coach. I have helped 200+ runners complete their first marathon and BQ.', specialties: ['Marathon Training','Cardio & Endurance','Sports Nutrition'], city: 'Mumbai', rate: 1500, exp: 8,  virtual: true,  inPerson: false, rating: 4.7, gender: 'male' },
  { name: 'Deepika Rajan',   business: 'LongRun Training',         bio: 'Ultra-marathon runner and coach. Specializing in building the mental and physical endurance for long distances.', specialties: ['Marathon Training','Cardio & Endurance','Stress Management'], city: 'Pune', rate: 1200, exp: 6,  virtual: true,  inPerson: true,  rating: 4.5, gender: 'female' },

  // ── Sleep Optimization ──
  { name: 'Dr. Neha Awasthi', business: 'SleepSmart Clinic',       bio: 'Sleep health specialist combining CBT-I, sleep hygiene coaching, and lifestyle medicine.', specialties: ['Sleep Optimization','Stress Management','Mental Health'], city: 'Delhi', rate: 3500, exp: 11, virtual: true, inPerson: false, rating: 4.9, gender: 'female' },
  { name: 'Prakash Deshpande', business: 'RestWell Coaching',      bio: 'Certified sleep coach helping professionals overcome insomnia, jet lag, and shift-work sleep disorder.', specialties: ['Sleep Optimization','Stress Management','Mindfulness'], city: 'Mumbai', rate: 2000, exp: 7,  virtual: true,  inPerson: false, rating: 4.6, gender: 'male' },

  // ── Holistic / Lifestyle ──
  { name: 'Usha Balakrishnan', business: 'Wholeness Wellness',     bio: 'Integrative health coach blending Ayurveda, modern nutrition, and mindfulness for complete wellness.', specialties: ['Mindfulness','Stress Management','Plant-Based Diet'], city: 'Bangalore', rate: 1400, exp: 16, virtual: true, inPerson: true, rating: 4.8, gender: 'female' },
  { name: 'Tarun Saxena',    business: 'LifeReset Coaching',        bio: 'Life and wellness coach specializing in corporate burnout recovery, habit formation, and sustainable health.', specialties: ['Stress Management','Weight Loss','Sleep Optimization'], city: 'Noida', rate: 2500, exp: 9,  virtual: true,  inPerson: false, rating: 4.6, gender: 'male' },
  { name: 'Bhavna Choudhary', business: 'Balance & Bloom',         bio: 'Womens health and wellness coach focusing on hormonal balance, PCOS management, and postnatal recovery.', specialties: ['Weight Loss','Stress Management','Mindfulness'], city: 'Jaipur', rate: 1800, exp: 7,  virtual: true,  inPerson: true,  rating: 4.7, gender: 'female' },
  { name: 'Sameer Ahuja',    business: 'MenStrong Wellness',        bio: 'Men\'s health coach addressing fitness, stress, testosterone optimization, and healthy aging.', specialties: ['Muscle Building','Stress Management','Sports Performance'], city: 'Chandigarh', rate: 2000, exp: 8, virtual: true, inPerson: true, rating: 4.5, gender: 'male' },
  { name: 'Girija Venkatesh', business: 'SeniorFit',               bio: 'Specialized in fitness and wellness for adults 60+. Low-impact training, balance, and fall prevention.', specialties: ['Rehabilitation','Flexibility & Mobility','Weight Loss'], city: 'Chennai', rate: 1000, exp: 18, virtual: true, inPerson: true, rating: 4.9, gender: 'female' },

  // ── HIIT / Strength ──
  { name: 'Akash Pandey',    business: 'IronWill Training',         bio: 'Powerlifting coach and HIIT specialist. I turn beginners into confident lifters in 12 weeks.', specialties: ['Muscle Building','HIIT Training','Strength Training'], city: 'Lucknow', rate: 1300, exp: 6,  virtual: false, inPerson: true,  rating: 4.4, gender: 'male' },
  { name: 'Divya Menon',     business: 'StrengthHer',               bio: 'Women\'s strength and body transformation specialist. I debunk myths and build real strength in women.', specialties: ['Muscle Building','HIIT Training','Weight Loss'], city: 'Bangalore', rate: 1600, exp: 5,  virtual: true,  inPerson: true,  rating: 4.6, gender: 'female' },

  // ── Online Only (no city) ──
  { name: 'Isha Kapoor',     business: 'VirtualCoach Pro',          bio: 'Online-only fitness and nutrition coach. I work with clients across India and abroad via video sessions.', specialties: ['Weight Loss','Sports Nutrition','HIIT Training'], city: 'Remote', rate: 800, exp: 4, virtual: true, inPerson: false, rating: 4.3, gender: 'female' },
  { name: 'Pankaj Rawat',    business: 'DigitalFit Academy',        bio: 'Online fitness coach with a community of 5000+ members. Specializes in home workouts and remote accountability coaching.', specialties: ['Weight Loss','Cardio & Endurance','Mindfulness'], city: 'Remote', rate: 500, exp: 3, virtual: true, inPerson: false, rating: 4.2, gender: 'male' },

  // ── More cities ──
  { name: 'Shilpa Goswami',  business: 'NorthEast Wellness Hub',    bio: 'Holistic wellness coach from Assam serving northeast India. Combines local herbal traditions with modern fitness.', specialties: ['Weight Loss','Mindfulness','Plant-Based Diet'], city: 'Guwahati', rate: 700, exp: 6,  virtual: true,  inPerson: true,  rating: 4.5, gender: 'female' },
  { name: 'Vineet Puri',     business: 'TechFit Hyderabad',         bio: 'Fitness coach specializing in helping IT professionals stay healthy despite sedentary desk jobs.', specialties: ['Stress Management','Weight Loss','Cardio & Endurance'], city: 'Hyderabad', rate: 1500, exp: 7, virtual: true, inPerson: true, rating: 4.6, gender: 'male' },
  { name: 'Rashmi Bhattacharya', business: 'Kolkata Wellness Club', bio: 'Community wellness coach offering group programs for weight loss, stress management, and healthy living.', specialties: ['Weight Loss','Stress Management','Cardio & Endurance'], city: 'Kolkata', rate: 800, exp: 9, virtual: true, inPerson: true, rating: 4.4, gender: 'female' },
  { name: 'Hardik Shah',     business: 'GujjuFit',                  bio: 'Gujarat-based fitness entrepreneur. Group HIIT classes, nutrition coaching, and marathon preparation.', specialties: ['HIIT Training','Marathon Training','Sports Nutrition'], city: 'Surat', rate: 900, exp: 5,  virtual: true,  inPerson: true,  rating: 4.3, gender: 'male' },
  { name: 'Manjula Reddy',   business: 'TeluganaFit',               bio: 'Andhra Pradesh wellness coach helping rural and urban clients with affordable online fitness and nutrition programs.', specialties: ['Weight Loss','Plant-Based Diet','Flexibility & Mobility'], city: 'Vijayawada', rate: 600, exp: 6, virtual: true, inPerson: false, rating: 4.4, gender: 'female' },
  { name: 'Cyrus Irani',     business: 'ParsiFit',                  bio: 'Fitness and nutrition coach blending Zoroastrian wellness traditions with modern evidence-based practice.', specialties: ['Muscle Building','Sports Nutrition','Stress Management'], city: 'Mumbai', rate: 2200, exp: 10, virtual: true, inPerson: true, rating: 4.7, gender: 'male' },
];

// ── User data ────────────────────────────────────────────────
const USERS = [
  { name: 'Rahul Agarwal',    email: 'rahul.agarwal@demo.com',   gender: 'male',   age: 32, fitnessLevel: 'beginner',     goals: ['Weight Loss','Better Sleep'],         conditions: 'mild hypertension',       city: 'Mumbai' },
  { name: 'Priya Sharma',     email: 'priya.sharma@demo.com',    gender: 'female', age: 28, fitnessLevel: 'intermediate',  goals: ['Muscle Building','Improve Stamina'],   conditions: 'none',                    city: 'Delhi' },
  { name: 'Ankit Joshi',      email: 'ankit.joshi@demo.com',     gender: 'male',   age: 45, fitnessLevel: 'beginner',     goals: ['Weight Loss','Stress Reduction'],      conditions: 'type 2 diabetes, obesity', city: 'Pune' },
  { name: 'Shreya Mehta',     email: 'shreya.mehta@demo.com',    gender: 'female', age: 24, fitnessLevel: 'advanced',     goals: ['Marathon Training','Endurance'],       conditions: 'none',                    city: 'Bangalore' },
  { name: 'Vijay Kumar',      email: 'vijay.kumar@demo.com',     gender: 'male',   age: 38, fitnessLevel: 'intermediate',  goals: ['Stress Management','Better Sleep'],    conditions: 'anxiety, insomnia',       city: 'Hyderabad' },
  { name: 'Kavya Nair',       email: 'kavya.nair@demo.com',      gender: 'female', age: 30, fitnessLevel: 'beginner',     goals: ['Weight Loss','Yoga'],                 conditions: 'PCOS',                    city: 'Kochi' },
  { name: 'Suresh Pillai',    email: 'suresh.pillai@demo.com',   gender: 'male',   age: 55, fitnessLevel: 'beginner',     goals: ['Joint Health','Flexibility'],          conditions: 'knee arthritis, age 55+', city: 'Chennai' },
  { name: 'Neha Gupta',       email: 'neha.gupta@demo.com',      gender: 'female', age: 26, fitnessLevel: 'intermediate',  goals: ['Plant-Based Diet','Weight Management'], conditions: 'lactose intolerant',      city: 'Jaipur' },
  { name: 'Rohit Yadav',      email: 'rohit.yadav@demo.com',     gender: 'male',   age: 22, fitnessLevel: 'advanced',     goals: ['Sports Performance','Muscle Gain'],   conditions: 'none, competitive athlete', city: 'Delhi' },
  { name: 'Sunita Patil',     email: 'sunita.patil@demo.com',    gender: 'female', age: 42, fitnessLevel: 'beginner',     goals: ['Weight Loss','Mental Wellness'],       conditions: 'thyroid, overweight',     city: 'Nagpur' },
  { name: 'Amit Verma',       email: 'amit.verma@demo.com',      gender: 'male',   age: 35, fitnessLevel: 'intermediate',  goals: ['HIIT Training','Weight Loss'],         conditions: 'borderline cholesterol',  city: 'Lucknow' },
  { name: 'Divya Krishnan',   email: 'divya.krishnan@demo.com',  gender: 'female', age: 29, fitnessLevel: 'advanced',     goals: ['Yoga','Mindfulness','Flexibility'],   conditions: 'mild back pain',          city: 'Bangalore' },
  { name: 'Manish Tomar',     email: 'manish.tomar@demo.com',    gender: 'male',   age: 50, fitnessLevel: 'beginner',     goals: ['Cardiac Health','Weight Loss'],        conditions: 'post cardiac surgery recovery', city: 'Gurgaon' },
  { name: 'Rupa Sinha',       email: 'rupa.sinha@demo.com',      gender: 'female', age: 33, fitnessLevel: 'intermediate',  goals: ['Postnatal Fitness','Core Strength'],   conditions: '6 months postpartum',    city: 'Kolkata' },
  { name: 'Deepak Bose',      email: 'deepak.bose@demo.com',     gender: 'male',   age: 27, fitnessLevel: 'intermediate',  goals: ['Sports Nutrition','Endurance'],        conditions: 'runner, wants to run faster', city: 'Mumbai' },
  { name: 'Asha Reddy',       email: 'asha.reddy@demo.com',      gender: 'female', age: 48, fitnessLevel: 'beginner',     goals: ['Weight Loss','Senior Fitness'],        conditions: 'menopause, joint stiffness', city: 'Hyderabad' },
  { name: 'Kiran Malhotra',   email: 'kiran.malhotra@demo.com',  gender: 'male',   age: 31, fitnessLevel: 'intermediate',  goals: ['Stress Reduction','Sleep Quality'],    conditions: 'burnout, IT professional', city: 'Noida' },
  { name: 'Tanya Singh',      email: 'tanya.singh@demo.com',     gender: 'female', age: 23, fitnessLevel: 'advanced',     goals: ['Muscle Building','Strength Training'], conditions: 'none',                   city: 'Chandigarh' },
  { name: 'Venkat Rao',       email: 'venkat.rao@demo.com',      gender: 'male',   age: 60, fitnessLevel: 'beginner',     goals: ['Balance','Fall Prevention','Joint Health'], conditions: 'osteoporosis, diabetes', city: 'Vijayawada' },
  { name: 'Meghna Das',       email: 'meghna.das@demo.com',      gender: 'female', age: 36, fitnessLevel: 'intermediate',  goals: ['Weight Loss','Mindfulness','Work-Life Balance'], conditions: 'high stress lifestyle', city: 'Bangalore' },
];

async function getRoleId(roleName: string): Promise<string> {
  const [role] = await authDb.select().from(roles).where(eq(roles.name, roleName)).limit(1);
  if (!role) throw new Error(`Role '${roleName}' not found. Did you run the auth seed first?`);
  return role.id;
}

async function seedProviders(userRoleId: string, providerRoleId: string) {
  console.log('\n📦 Seeding 50 providers...');
  let count = 0;

  for (const p of PROVIDERS) {
    const firstName = p.name.split(' ')[0];
    const lastName = p.name.split(' ').slice(1).join(' ') || 'Provider';
    const emailBase = p.name.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.');
    const email = `${emailBase}@provider.demo`;

    // Skip if already exists
    const [existingCred] = await authDb.select().from(credentials).where(eq(credentials.email, email)).limit(1);
    if (existingCred) {
      console.log(`  ⏭  ${p.name} already seeded`);
      continue;
    }

    // 1. Auth credential
    const passwordHash = await hashPassword('Provider123!');
    const [cred] = await authDb.insert(credentials).values({
      email,
      password_hash: passwordHash,
      status: 'active',
      email_verified: true,
      last_password_change: new Date(),
    }).returning();

    // Assign provider role
    await authDb.insert(user_roles).values({ credential_id: cred.id, role_id: providerRoleId }).onConflictDoNothing();

    // 2. User record in core DB
    const [user] = await coreDb.insert(users).values({
      auth_id: cred.id,
      email,
      first_name: firstName,
      last_name: lastName,
      gender: p.gender as any,
      timezone: 'Asia/Kolkata',
      status: 'active',
    }).returning();

    // 3. Provider profile
    const modes = [];
    if (p.virtual)   modes.push('virtual');
    if (p.inPerson)  modes.push('in-person');

    await coreDb.insert(providers).values({
      user_id: user.id,
      business_name: p.business,
      display_name: p.name,
      bio: p.bio,
      specialties: p.specialties,
      credentials: ['Certified Professional'],
      years_experience: p.exp,
      hourly_rate: String(p.rate),
      currency: 'INR',
      location: { city: p.city, state: 'India', lat: null, lng: null },
      offers_virtual: p.virtual,
      offers_in_person: p.inPerson,
      status: 'verified',
      rating_avg: String(p.rating),
      review_count: Math.floor(Math.random() * 100) + 10,
      total_bookings: Math.floor(Math.random() * 200) + 20,
    });

    count++;
    console.log(`  ✅ [${count}] ${p.name} — ${p.specialties[0]} — ${p.city}`);
  }

  console.log(`\n✅ ${count} providers seeded`);
}

async function seedUsers(userRoleId: string) {
  console.log('\n👤 Seeding 20 users...');
  let count = 0;

  for (const u of USERS) {
    const firstName = u.name.split(' ')[0];
    const lastName = u.name.split(' ').slice(1).join(' ') || 'User';

    const [existingCred] = await authDb.select().from(credentials).where(eq(credentials.email, u.email)).limit(1);
    if (existingCred) {
      console.log(`  ⏭  ${u.name} already seeded`);
      continue;
    }

    // 1. Auth credential
    const passwordHash = await hashPassword('User123!');
    const [cred] = await authDb.insert(credentials).values({
      email: u.email,
      password_hash: passwordHash,
      status: 'active',
      email_verified: true,
      last_password_change: new Date(),
    }).returning();

    await authDb.insert(user_roles).values({ credential_id: cred.id, role_id: userRoleId }).onConflictDoNothing();

    // 2. User record
    const [user] = await coreDb.insert(users).values({
      auth_id: cred.id,
      email: u.email,
      first_name: firstName,
      last_name: lastName,
      gender: u.gender as any,
      timezone: 'Asia/Kolkata',
      status: 'active',
    }).returning();

    // 3. User profile
    await coreDb.insert(user_profiles).values({
      user_id: user.id,
      bio: `${u.name} from ${u.city}. Health goals: ${u.goals.join(', ')}.`,
      country: 'IN',
      health_goals: u.goals,
      dietary_preferences: [],
      fitness_level: u.fitnessLevel as any,
      wellness_interests: u.goals,
      preferred_session_type: 'virtual',
    });

    // 4. Health profile
    await coreDb.insert(health_profiles).values({
      user_id: user.id,
      notes: `Conditions: ${u.conditions}. City: ${u.city}. Age: ${u.age}.`,
      consent_health_sharing: true,
      consent_ai_analysis: true,
    });

    count++;
    console.log(`  ✅ [${count}] ${u.name} — ${u.email} — ${u.city}`);
  }

  console.log(`\n✅ ${count} users seeded`);
}

async function main() {
  console.log('🌱 Starting demo seed...\n');

  const userRoleId     = await getRoleId('user');
  const providerRoleId = await getRoleId('provider');

  await seedProviders(userRoleId, providerRoleId);
  await seedUsers(userRoleId);

  console.log('\n\n🎉 Done! Summary:');
  const [{ count: pCount }] = await coreDb.execute<{ count: string }>(
    'SELECT COUNT(*) as count FROM providers WHERE status = \'verified\''
  );
  const [{ count: uCount }] = await coreDb.execute<{ count: string }>(
    'SELECT COUNT(*) as count FROM users'
  );
  console.log(`  Providers in DB: ${pCount}`);
  console.log(`  Users in DB:     ${uCount}`);
  console.log('\nCredentials:');
  console.log('  Provider password: Provider123!');
  console.log('  User password:     User123!');
  console.log('  Admin: admin@longeny.com / Admin123!@#');

  await authSql.end();
  await coreSql.end();
  process.exit(0);
}

main().catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); });
