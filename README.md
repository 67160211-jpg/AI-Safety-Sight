# 🛡️ AI Safety Sight - ระบบเฝ้าระวังความปลอดภัยด้วยกล้องวงจรปิดและ AI

**AI Safety Sight** คือระบบจำลองการเฝ้าระวังความปลอดภัยในพื้นที่เขตก่อสร้างหรือโรงงานอุตสาหกรรมแบบเรียลไทม์ ผ่านกล้องวงจรปิดร่วมกับระบบวิเคราะห์ด้วย AI เพื่อตรวจจับความเสี่ยงและแจ้งเตือนอุบัติเหตุล่วงหน้า

---

## 📐 Microservices Architecture

```mermaid
graph TD
    subgraph Client_Layer ["Client Layer (ผู้ใช้งาน)"]
        Client_Web["Web Browser / Dashboard"]
        Client_Mobile["Mobile Browser"]
    end

    subgraph Gateway_Layer ["API Gateway & Routing Layer"]
        Gateway["Express Router / API Gateway"]
    end

    subgraph Microservices ["Microservices Domain"]
        Auth_Service["Auth Service<br/>(JWT / Password Hashing)"]
        Camera_Service["Camera & Vision Service<br/>(Stream & AI Bounding Box)"]
        Alert_Service["Alert & Incident Service<br/>(Safety Log Management)"]
    end

    subgraph Data_Layer ["Database & Storage Layer"]
        DB[(SQLite3 Database)]
        Volume[("Docker Persistent Volume<br/>(/app/data)")]
    end

    Client_Web --> Gateway
    Client_Mobile --> Gateway

    Gateway --> Auth_Service
    Gateway --> Camera_Service
    Gateway --> Alert_Service

    Auth_Service --> DB
    Camera_Service --> DB
    Alert_Service --> DB

    DB --- Volume

graph TD
    subgraph Presentation ["1. Presentation Layer (Frontend)"]
        UI["HTML5 / Tailwind CSS (Dark Mode UI)"]
        JS["Vanilla JavaScript (Single Page Application)"]
    end

    subgraph Core_App ["2. Core Application & API Gateway"]
        Node["Node.js (v18+) Runtime"]
        Express["Express.js Framework"]
        Auth_Sec["JWT & Bcrypt Security"]
    end

    subgraph AI_Engine ["3. AI & Computer Vision Engine"]
        YOLO["YOLOv8 / Pose Detection (Concept)"]
        Mock_AI["AI Event Simulation Engine"]
    end

    subgraph Data_Storage ["4. Database & Storage Layer"]
        SQLite[(SQLite3 File-based DB)]
        Doc_Vol["Docker Volume Mappings"]
    end

    subgraph DevOps_Infra ["5. DevOps & Infrastructure"]
        Docker["Docker Containerization"]
        Compose["Docker Compose Orchestration"]
        Cloud["Render.com Cloud Hosting"]
    end

    Presentation <--> Core_App
    Core_App <--> AI_Engine
    Core_App <--> Data_Storage
    Core_App --- DevOps_Infra