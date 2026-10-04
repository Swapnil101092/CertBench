// Built-in certification banks added after the original six in src/seed.js.
// Metadata lives here; each exam's questions live in ./<slug>.json as
// [question, correctAnswer, distractor, distractor, distractor, 0] (options are shuffled at seed time).
// Every bank has 150 unique questions, which the seed splits into 5 sets of 30 with no repeats.
const path = require('node:path');

const META = [
  // IT management & architecture
  { slug:'itil4-foundation', name:'ITIL 4 Foundation', short_label:'ITIL', color:'#7c3aed', price_inr:499,
    description:'ITIL 4 service management: the service value system, guiding principles, four dimensions, value chain and key practices.' },
  { slug:'pmp', name:'PMP – Project Management Professional', short_label:'PMP', color:'#0ea5e9', price_inr:599,
    description:'People, process and business environment domains across predictive, agile and hybrid project approaches.' },
  { slug:'togaf', name:'TOGAF Enterprise Architecture', short_label:'TOGF', color:'#64748b', price_inr:599,
    description:'TOGAF Standard concepts: the ADM phases, architecture content, governance, repository and capability framework.' },

  // Testing
  { slug:'istqb-ctfl', name:'ISTQB Certified Tester – Foundation Level (CTFL)', short_label:'CTFL', color:'#ec4899', price_inr:499,
    description:'ISTQB CTFL syllabus: testing fundamentals, testing across the SDLC, static testing, test techniques, test management and tools.' },

  // CompTIA
  { slug:'comptia-a-plus', name:'CompTIA A+', short_label:'A+', color:'#dc2626', price_inr:499,
    description:'Hardware, mobile devices, networking, operating systems, security, software troubleshooting and operational procedures.' },
  { slug:'comptia-network-plus', name:'CompTIA Network+', short_label:'NET+', color:'#dc2626', price_inr:499,
    description:'Networking concepts, implementation, operations, security and troubleshooting across wired and wireless networks.' },
  { slug:'comptia-security-plus', name:'CompTIA Security+', short_label:'SEC+', color:'#dc2626', price_inr:499,
    description:'Security concepts, threats and vulnerabilities, security architecture, security operations, and program management and oversight.' },
  { slug:'comptia-cysa-plus', name:'CompTIA CySA+', short_label:'CYSA', color:'#dc2626', price_inr:599,
    description:'Security operations, vulnerability management, incident response and reporting for cybersecurity analysts.' },
  { slug:'comptia-pentest-plus', name:'CompTIA PenTest+', short_label:'PEN+', color:'#dc2626', price_inr:599,
    description:'Planning and scoping, reconnaissance, vulnerability discovery, attacks and exploits, post-exploitation and reporting.' },

  // Cisco networking
  { slug:'cisco-ccna', name:'Cisco CCNA', short_label:'CCNA', color:'#049fd9', price_inr:599,
    description:'Network fundamentals, access, IP connectivity, IP services, security fundamentals, automation and programmability.' },
  { slug:'cisco-ccnp-enterprise', name:'Cisco CCNP Enterprise', short_label:'CCNP', color:'#049fd9', price_inr:599,
    description:'Enterprise architecture, virtualization, advanced routing, SD-WAN, wireless, network assurance, security and automation.' },

  // Security
  { slug:'isc2-cc', name:'ISC2 Certified in Cybersecurity (CC)', short_label:'CC', color:'#16a34a', price_inr:499,
    description:'Security principles, business continuity and incident response, access control, network security and security operations.' },
  { slug:'cissp', name:'CISSP', short_label:'CISP', color:'#16a34a', price_inr:599,
    description:'The eight CISSP domains, from security and risk management through software development security.' },
  { slug:'ccsp', name:'CCSP – Certified Cloud Security Professional', short_label:'CCSP', color:'#16a34a', price_inr:599,
    description:'Cloud concepts and design, cloud data security, platform and application security, cloud operations, legal, risk and compliance.' },
  { slug:'cisa', name:'CISA', short_label:'CISA', color:'#1d4ed8', price_inr:599,
    description:'Information systems auditing: the audit process, IT governance, acquisition and implementation, operations and asset protection.' },
  { slug:'cism', name:'CISM', short_label:'CISM', color:'#1d4ed8', price_inr:599,
    description:'Information security governance, risk management, security program development and management, and incident management.' },
  { slug:'crisc', name:'CRISC', short_label:'CRSC', color:'#1d4ed8', price_inr:599,
    description:'IT risk governance, risk assessment, risk response and reporting, and information technology and security controls.' },
  { slug:'gsec', name:'GIAC Security Essentials (GSEC)', short_label:'GSEC', color:'#0f766e', price_inr:599,
    description:'Hands-on security essentials: defense in depth, networking, cryptography, Windows and Linux security, and incident handling.' },

  // AWS
  { slug:'aws-saa', name:'AWS Certified Solutions Architect – Associate', short_label:'SAA', color:'#f59e0b', price_inr:599,
    description:'Designing secure, resilient, high-performing and cost-optimized architectures on AWS.' },
  { slug:'aws-developer-associate', name:'AWS Certified Developer – Associate', short_label:'DVA', color:'#f59e0b', price_inr:599,
    description:'Developing with AWS services, security, deployment, and troubleshooting and optimization of cloud applications.' },
  { slug:'aws-sysops', name:'AWS Certified SysOps Administrator / CloudOps Engineer', short_label:'SOA', color:'#f59e0b', price_inr:599,
    description:'Monitoring, reliability, deployment and automation, security, networking and cost optimization of AWS workloads.' },
  { slug:'aws-data-engineer', name:'AWS Certified Data Engineer – Associate', short_label:'DEA', color:'#f59e0b', price_inr:599,
    description:'Data ingestion and transformation, data store management, data operations and support, and data security on AWS.' },
  { slug:'aws-sap', name:'AWS Certified Solutions Architect – Professional', short_label:'SAP', color:'#f59e0b', price_inr:599,
    description:'Complex multi-account architectures, new solutions, continuous improvement, and migration and modernization on AWS.' },
  { slug:'aws-devops-pro', name:'AWS Certified DevOps Engineer – Professional', short_label:'DOP', color:'#f59e0b', price_inr:599,
    description:'SDLC automation, configuration management and IaC, resilient solutions, monitoring, incident response and security on AWS.' },
  { slug:'aws-security-specialty', name:'AWS Certified Security – Specialty', short_label:'SCS', color:'#f59e0b', price_inr:599,
    description:'Threat detection, incident response, logging and monitoring, infrastructure security, IAM, data protection and governance on AWS.' },

  // Microsoft
  { slug:'az-104', name:'Microsoft Azure Administrator Associate (AZ-104)', short_label:'A104', color:'#0078d4', price_inr:599,
    description:'Managing Azure identities and governance, storage, compute resources, virtual networking, and monitoring and maintenance.' },
  { slug:'az-305', name:'Microsoft Azure Solutions Architect Expert (AZ-305)', short_label:'A305', color:'#0078d4', price_inr:599,
    description:'Designing identity, governance and monitoring, data storage, business continuity and infrastructure solutions on Azure.' },
  { slug:'az-500', name:'Microsoft Azure Security Engineer Associate (AZ-500)', short_label:'A500', color:'#0078d4', price_inr:599,
    description:'Securing identity and access, networking, compute, storage and databases, and managing security operations in Azure.' },
  { slug:'sc-900', name:'Microsoft Security, Compliance & Identity Fundamentals (SC-900)', short_label:'S900', color:'#0078d4', price_inr:499,
    description:'Security, compliance and identity concepts, Microsoft Entra, Microsoft security solutions and Microsoft Purview compliance.' },
  { slug:'pl-300', name:'Microsoft Power BI Data Analyst (PL-300)', short_label:'P300', color:'#f2c811', price_inr:599,
    description:'Preparing, modeling and visualizing data, and deploying and maintaining assets with Power BI.' },

  // Google Cloud
  { slug:'google-ace', name:'Google Associate Cloud Engineer', short_label:'ACE', color:'#ea4335', price_inr:599,
    description:'Setting up a cloud environment, planning, deploying and operating solutions, and configuring access and security on Google Cloud.' },
  { slug:'google-pca', name:'Google Professional Cloud Architect', short_label:'PCA', color:'#ea4335', price_inr:599,
    description:'Designing, managing and securing Google Cloud solutions, analyzing processes, and ensuring reliability.' },
  { slug:'google-pde', name:'Google Professional Data Engineer', short_label:'PDE', color:'#ea4335', price_inr:599,
    description:'Designing data processing systems, ingesting, processing and storing data, and preparing and automating data workloads on Google Cloud.' },

  // Oracle
  { slug:'oracle-java', name:'Oracle Certified Professional: Java', short_label:'JAVA', color:'#c74634', price_inr:599,
    description:'Java SE language fundamentals, OOP, generics and collections, streams and lambdas, exceptions, concurrency, I/O and modules.' },
  { slug:'oci-architect-associate', name:'Oracle Cloud Infrastructure (OCI) Architect Associate', short_label:'OCI', color:'#c74634', price_inr:599,
    description:'OCI compute, networking, storage, database, identity and security services, and designing highly available architectures.' },

  // Data platforms
  { slug:'databricks-data-engineer-associate', name:'Databricks Certified Data Engineer Associate', short_label:'DBX', color:'#ff3621', price_inr:599,
    description:'Databricks Lakehouse platform, Delta Lake, ELT with Spark SQL and Python, incremental processing, pipelines and Unity Catalog.' },
  { slug:'snowpro-core', name:'SnowPro Core', short_label:'SNOW', color:'#29b5e8', price_inr:599,
    description:'Snowflake architecture, account access and security, performance, data loading and unloading, transformations and data protection.' },

  // Kubernetes & IaC
  { slug:'cka', name:'Certified Kubernetes Administrator (CKA)', short_label:'CKA', color:'#326ce5', price_inr:599,
    description:'Cluster architecture and installation, workloads and scheduling, services and networking, storage and troubleshooting.' },
  { slug:'ckad', name:'Certified Kubernetes Application Developer (CKAD)', short_label:'CKAD', color:'#326ce5', price_inr:599,
    description:'Application design and build, deployment, observability and maintenance, environment and configuration, services and networking.' },
  { slug:'cks', name:'Certified Kubernetes Security Specialist (CKS)', short_label:'CKS', color:'#326ce5', price_inr:599,
    description:'Cluster setup and hardening, system hardening, minimizing microservice vulnerabilities, supply chain security and runtime security.' },
  { slug:'terraform-associate', name:'HashiCorp Terraform Associate', short_label:'TF', color:'#7b42bc', price_inr:499,
    description:'Infrastructure as code concepts, Terraform workflow, providers, modules, state management, and HCP Terraform features.' },

  // Linux
  { slug:'rhcsa', name:'Red Hat Certified System Administrator (RHCSA)', short_label:'RHSA', color:'#ee0000', price_inr:599,
    description:'RHEL system administration: shell, users and groups, storage, file systems, networking, SELinux, services and containers.' },
  { slug:'rhce', name:'Red Hat Certified Engineer (RHCE)', short_label:'RHCE', color:'#ee0000', price_inr:599,
    description:'Automating RHEL administration with Ansible: inventories, playbooks, variables, roles, templates, collections and content.' },

  // SaaS platforms
  { slug:'servicenow-csa', name:'ServiceNow Certified System Administrator (CSA)', short_label:'CSA', color:'#62d84e', price_inr:599,
    description:'ServiceNow platform UI, configuration, collaboration, database management, self-service and automation, and data migration.' },
  { slug:'salesforce-admin', name:'Salesforce Certified Administrator', short_label:'SFDC', color:'#00a1e0', price_inr:599,
    description:'Salesforce configuration and setup, object manager, sales and service cloud, data and analytics, and automation.' }
];

const BANKS = META.map(m => ({
  duration_minutes: 60,
  pass_pct: 70,
  ...m,
  questions: require(path.join(__dirname, m.slug + '.json'))
}));

module.exports = { BANKS, META };
