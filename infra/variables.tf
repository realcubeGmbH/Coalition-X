# =============================================================================
# INPUT VARIABLES
# =============================================================================

variable "aws_region" {
  description = "AWS region where resources will be created"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Name of the project for resource naming"
  type        = string
  default     = "exchange-layer"
}

# =============================================================================
# NETWORKING VARIABLES
# =============================================================================

variable "create_new_vpc" {
  description = "Whether to create a new VPC or use an existing one"
  type        = bool
  default     = true
}

variable "existing_vpc_id" {
  description = "ID of existing VPC to use (only if create_new_vpc = false)"
  type        = string
  default     = null
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones_count" {
  description = "Number of availability zones to use"
  type        = number
  default     = 2
}

# =============================================================================
# DATABASE VARIABLES
# =============================================================================

variable "db_instance_class" {
  description = "RDS instance type"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS storage size in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Name of the database"
  type        = string
  default     = "exchange_layer"
}

variable "db_username" {
  description = "Database admin username"
  type        = string
  default     = "exchange_layer_user"
}

# =============================================================================
# APPLICATION VARIABLES  
# =============================================================================

variable "container_port" {
  description = "Port the container listens on (Next.js default)"
  type        = number
  default     = 3000
}

variable "app_cpu" {
  description = "CPU units for the container (256 = 0.25 vCPU, 512 = 0.5 vCPU)"
  type        = number
  default     = 512
}

variable "app_memory" {
  description = "Memory for the container in MB"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS tasks to run"
  type        = number
  default     = 1
}

variable "pom_partner_org_id" {
  description = "Organization ID for POM+ partner (only org allowed to use partner:org-sync scope)"
  type        = string
  default     = ""
}

variable "cors_allowed_origins" {
  description = "Browser origins allowed to call the API cross-site (e.g. the Erfassungs App domain). Comma-joined into the container's CORS_ALLOWED_ORIGINS env var. MUST be non-empty in production: an empty list means no Access-Control-Allow-Origin header is sent and every cross-origin browser request is blocked. Use full scheme+host, no trailing slash, e.g. \"https://erfassung.coalition-x.eu\"."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for o in var.cors_allowed_origins : can(regex("^https?://[^/]+$", o))])
    error_message = "Each CORS origin must be scheme + host with no path or trailing slash (e.g. https://erfassung.coalition-x.eu)."
  }
}

# =============================================================================
# OPTIONAL: BASTION HOST
# =============================================================================

variable "create_bastion" {
  description = "Whether to create a bastion host for DB access"
  type        = bool
  default     = false
}

variable "bastion_authorized_keys" {
  type        = list(string)
  description = "A list of public SSH keys to authorize for bastion access"
  default     = []
}

# =============================================================================
# SSL/TLS CERTIFICATE
# =============================================================================

variable "enable_https" {
  description = "Whether to enable HTTPS with SSL/TLS certificate"
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Domain name for the ACM certificate (required if enable_https = true and certificate_arn is not provided)"
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "ARN of existing ACM certificate (optional - if not provided, a new certificate will be created)"
  type        = string
  default     = null
}

variable "certificate_validation_method" {
  description = "Method to validate the certificate (DNS or EMAIL)"
  type        = string
  default     = "DNS"

  validation {
    condition     = var.certificate_validation_method == "DNS" || var.certificate_validation_method == "EMAIL"
    error_message = "Certificate validation method must be either 'DNS' or 'EMAIL'."
  }
}

variable "certificate_subject_alternative_names" {
  description = "Additional domain names for the certificate (e.g., ['www.example.com', 'api.example.com'])"
  type        = list(string)
  default     = []
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for automatic DNS validation (optional - for automatic certificate validation)"
  type        = string
  default     = null
}

variable "ssl_policy" {
  description = "SSL policy for the HTTPS listener"
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}
