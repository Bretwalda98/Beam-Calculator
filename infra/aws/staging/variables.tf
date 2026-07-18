variable "aws_region" {
  description = "AWS staging region. The programme requires eu-west-2."
  type        = string
  default     = "eu-west-2"

  validation {
    condition     = var.aws_region == "eu-west-2"
    error_message = "CAD/FEM staging must remain in eu-west-2."
  }
}

variable "name_prefix" {
  type    = string
  default = "beam-cad-fem-staging"
}

variable "vpc_id" {
  description = "Existing staging VPC."
  type        = string
}

variable "private_subnet_ids" {
  description = "At least two private subnets with controlled outbound access."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "Provide at least two private subnets in different availability zones."
  }
}

variable "api_image" {
  description = "Immutable ECR image URI (prefer a sha256 digest) for the Node API."
  type        = string
}

variable "native_image" {
  description = "Immutable ECR image URI for the pinned OCCT/Netgen/MFEM Batch runner."
  type        = string
}

variable "cloudflared_image" {
  description = "Pinned cloudflared image URI including a digest."
  type        = string
}

variable "r2_endpoint" {
  description = "R2 S3 API endpoint, for example https://ACCOUNT_ID.r2.cloudflarestorage.com."
  type        = string
}

variable "r2_bucket" {
  type    = string
  default = "beam-cad-fem-staging"
}

variable "verification_step_sha256" {
  description = "SHA-256 of the reviewed 1000 x 50 x 100 mm axial-bar STEP fixture. Arbitrary solve input remains disabled."
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{64}$", var.verification_step_sha256))
    error_message = "verification_step_sha256 must be a lowercase hexadecimal SHA-256 digest."
  }
}

variable "allowed_origins" {
  description = "Comma-separated Pages/custom origins allowed by the staging API."
  type        = string
}

variable "database_name" {
  type    = string
  default = "beam_calculator"
}

variable "database_username" {
  type    = string
  default = "cadfem"
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "batch_max_vcpus" {
  type    = number
  default = 64
}
